/**
 * admin-auth.ts — IP filtering, session auth, login/setup pages for admin.
 *
 * No external dependencies — CIDR matching and session tokens are pure JS.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { AppConfig } from "./types.js";

// ── CIDR matching ──

function parseIPv4(ip: string): number | null {
    // Handle IPv4-mapped IPv6 like ::ffff:192.168.1.1
    const mapped = ip.replace(/^::ffff:/, "");
    const parts = mapped.split(".");
    if (parts.length !== 4) return null;
    const nums = parts.map(Number);
    if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
    return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

function cidrMatchIPv4(ip: string, cidr: string): boolean {
    const [network, prefixStr] = cidr.split("/");
    const prefix = parseInt(prefixStr, 10);
    const ipNum = parseIPv4(ip);
    const netNum = parseIPv4(network);
    if (ipNum === null || netNum === null || isNaN(prefix)) return false;
    if (prefix === 0) return true;
    const mask = (~0 << (32 - prefix)) >>> 0;
    return (ipNum & mask) === (netNum & mask);
}

export function isAllowed(ip: string, cidrs: string[]): boolean {
    // Normalize
    const normalized = ip.replace(/^::ffff:/, "");

    for (const cidr of cidrs) {
        // IPv6 loopback
        if (cidr === "::1/128" && (ip === "::1" || normalized === "::1")) return true;
        // IPv4 CIDR
        if (cidrMatchIPv4(normalized, cidr)) return true;
        // Exact IP match
        if (cidr === normalized || cidr === ip) return true;
    }
    return false;
}

// ── Session tokens ──

const SESSION_COOKIE = "instapod_session";
const SESSION_MAX_AGE = 7 * 24 * 3600 * 1000; // 7 days

function getSecret(config: AppConfig): string {
    return config.admin?.session_secret || "instapod-default-secret-change-me";
}

function createSessionToken(secret: string): string {
    const payload = JSON.stringify({
        iat: Date.now(),
        exp: Date.now() + SESSION_MAX_AGE,
    });
    const encoded = Buffer.from(payload).toString("base64url");
    const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
    return `${encoded}.${sig}`;
}

function verifySessionToken(token: string, secret: string): boolean {
    const [encoded, sig] = token.split(".");
    if (!encoded || !sig) return false;
    const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
    if (sig !== expected) return false;
    try {
        const payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
        return payload.exp > Date.now();
    } catch {
        return false;
    }
}

// ── Middleware: IP filter ──

export function createIpFilter(getConfig: () => AppConfig) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const clientIp = req.ip || req.socket.remoteAddress || "";
        const cidrs = getConfig().admin?.allowed_cidrs || [];

        if (cidrs.length === 0 || isAllowed(clientIp, cidrs)) {
            next();
        } else {
            console.log(`[auth] Blocked ${req.method} ${req.originalUrl} from ${clientIp}`);
            res.status(403).send(render403Page(clientIp));
        }
    };
}

// ── Middleware: Auth guard ──

export function createAuthGuard(getConfig: () => AppConfig) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const config = getConfig();
        const hasPassword = !!config.admin?.password;
        const url = req.originalUrl;

        // Setup endpoint is always accessible (within IP filter)
        if (url === "/api/admin/setup" && req.method === "POST") {
            next();
            return;
        }

        // No password set — only allow admin page (shows setup) and setup POST
        if (!hasPassword) {
            if (url === "/admin") {
                res.send(renderSetupPage());
                return;
            }
            res.status(403).json({ error: "Admin password not configured" });
            return;
        }

        // Login endpoint is always accessible
        if (url === "/api/admin/login" && req.method === "POST") {
            next();
            return;
        }

        // Check session cookie
        const cookies = parseCookies(req.headers.cookie || "");
        const token = cookies[SESSION_COOKIE];

        if (token && verifySessionToken(token, getSecret(config))) {
            next();
            return;
        }

        // No valid session — show login page for GET /admin, 401 for API
        if (url === "/admin") {
            res.send(renderLoginPage());
            return;
        }
        res.status(401).json({ error: "Authentication required" });
    };
}

// ── Auth route handlers ──

export function handleLogin(
    req: Request,
    res: Response,
    getConfig: () => AppConfig
): void {
    const clientIp = req.ip || req.socket.remoteAddress || "";

    // Rate limit login attempts
    if (isLoginRateLimited(clientIp)) {
        console.log(`[auth] Rate limited login from ${clientIp}`);
        res.status(429).json({ error: "Too many login attempts. Try again later." });
        return;
    }

    const { password } = req.body || {};
    const config = getConfig();

    if (!password || password !== config.admin?.password) {
        res.status(401).json({ error: "Invalid password" });
        return;
    }

    clearLoginRateLimit(clientIp);
    const token = createSessionToken(getSecret(config));
    res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        maxAge: SESSION_MAX_AGE,
        sameSite: "lax",
        path: "/",
    });
    res.json({ status: "ok" });
}

export function handleSetup(
    req: Request,
    res: Response,
    getConfig: () => AppConfig,
    setConfig: (c: AppConfig) => void,
    saveConfigFn: (c: AppConfig) => void
): void {
    const config = getConfig();
    if (config.admin?.password) {
        res.status(400).json({ error: "Password already set. Use login instead." });
        return;
    }

    const { password } = req.body || {};
    if (!password || typeof password !== "string" || password.length < 4) {
        res.status(400).json({ error: "Password must be at least 4 characters" });
        return;
    }

    // Generate session secret
    const sessionSecret = randomBytes(32).toString("hex");

    const updated = {
        ...config,
        admin: {
            ...config.admin,
            password,
            session_secret: sessionSecret,
        },
    };

    saveConfigFn(updated);
    setConfig(updated);

    // Auto-login after setup
    const token = createSessionToken(sessionSecret);
    res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        maxAge: SESSION_MAX_AGE,
        sameSite: "lax",
        path: "/",
    });
    res.json({ status: "ok", message: "Password set successfully" });
}

export function handleLogout(_req: Request, res: Response): void {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ status: "ok" });
}

// ── Rate limiting ──

const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();

/**
 * Simple in-memory rate limiter for login attempts.
 * Returns true if the request should be blocked.
 */
export function isLoginRateLimited(ip: string): boolean {
    const now = Date.now();
    const entry = loginAttempts.get(ip);

    if (!entry || now - entry.firstAttempt > LOGIN_WINDOW_MS) {
        // Window expired or first attempt — reset
        loginAttempts.set(ip, { count: 1, firstAttempt: now });
        return false;
    }

    entry.count++;
    if (entry.count > LOGIN_MAX_ATTEMPTS) {
        return true;
    }
    return false;
}

/** Clear rate limit for an IP after successful login. */
export function clearLoginRateLimit(ip: string): void {
    loginAttempts.delete(ip);
}

// Periodically clean stale entries (every 5 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of loginAttempts) {
        if (now - entry.firstAttempt > LOGIN_WINDOW_MS) {
            loginAttempts.delete(ip);
        }
    }
}, 5 * 60 * 1000).unref();

// ── Helpers ──

function parseCookies(header: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    header.split(";").forEach((part) => {
        const [key, ...rest] = part.trim().split("=");
        if (key) cookies[key] = rest.join("=");
    });
    return cookies;
}

// ── HTML Pages ──

function renderLoginPage(): string {
    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Instapod — Login</title>
<style>${authPageStyles()}</style>
</head><body>
<div class="auth-container">
  <h1>🎙️ Instapod</h1>
  <p class="subtitle">Enter your admin password</p>
  <form onsubmit="return doLogin(event)">
    <input type="password" id="pw" placeholder="Password" autofocus required>
    <button type="submit" id="btn">Sign In</button>
    <div id="error" class="error"></div>
  </form>
</div>
<script>
async function doLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('btn');
  const err = document.getElementById('error');
  btn.disabled = true; btn.textContent = 'Signing in...';
  err.textContent = '';
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('pw').value })
    });
    if (r.ok) { window.location.href = '/admin'; }
    else { const d = await r.json(); err.textContent = d.error || 'Login failed'; }
  } catch { err.textContent = 'Network error'; }
  btn.disabled = false; btn.textContent = 'Sign In';
}
</script></body></html>`;
}

function renderSetupPage(): string {
    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Instapod — Setup</title>
<style>${authPageStyles()}</style>
</head><body>
<div class="auth-container">
  <h1>🎙️ Instapod</h1>
  <p class="subtitle">Welcome! Set an admin password to get started.</p>
  <form onsubmit="return doSetup(event)">
    <input type="password" id="pw" placeholder="Choose a password" autofocus required minlength="4">
    <input type="password" id="pw2" placeholder="Confirm password" required minlength="4">
    <button type="submit" id="btn">Set Password</button>
    <div id="error" class="error"></div>
  </form>
</div>
<script>
async function doSetup(e) {
  e.preventDefault();
  const pw = document.getElementById('pw').value;
  const pw2 = document.getElementById('pw2').value;
  const btn = document.getElementById('btn');
  const err = document.getElementById('error');
  if (pw !== pw2) { err.textContent = 'Passwords do not match'; return; }
  btn.disabled = true; btn.textContent = 'Setting up...';
  err.textContent = '';
  try {
    const r = await fetch('/api/admin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    if (r.ok) { window.location.href = '/admin'; }
    else { const d = await r.json(); err.textContent = d.error || 'Setup failed'; }
  } catch { err.textContent = 'Network error'; }
  btn.disabled = false; btn.textContent = 'Set Password';
}
</script></body></html>`;
}

function render403Page(ip: string): string {
    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>403 — Access Denied</title>
<style>${authPageStyles()}</style>
</head><body>
<div class="auth-container">
  <h1>🚫</h1>
  <p class="subtitle">Access denied</p>
  <p style="color:#8b90a5;font-size:0.85rem;">Your IP <code>${ip}</code> is not in the allowed list.</p>
</div>
</body></html>`;
}

function authPageStyles(): string {
    return `
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background: #0f1117;
  color: #e1e4ed;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
}
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
.auth-container {
  background: #1a1d27;
  border: 1px solid #2e3348;
  border-radius: 16px;
  padding: 40px;
  width: 100%;
  max-width: 380px;
  text-align: center;
}
h1 { font-size: 1.5rem; margin-bottom: 8px;
  background: linear-gradient(135deg,#6c63ff,#8b83ff);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.subtitle { color: #8b90a5; margin-bottom: 24px; font-size: 0.9rem; }
form { display: flex; flex-direction: column; gap: 12px; }
input {
  padding: 12px 14px;
  background: #0f1117;
  border: 1px solid #2e3348;
  border-radius: 10px;
  color: #e1e4ed;
  font-size: 0.95rem;
  outline: none;
  font-family: inherit;
}
input:focus { border-color: #6c63ff; }
button {
  padding: 12px;
  background: linear-gradient(135deg,#6c63ff,#8b83ff);
  border: none;
  border-radius: 10px;
  color: #fff;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: box-shadow 0.15s;
}
button:hover { box-shadow: 0 4px 16px rgba(108,99,255,0.3); }
button:disabled { opacity: 0.6; cursor: default; }
.error { color: #ef4444; font-size: 0.85rem; min-height: 1.2em; }
code { background: #242837; padding: 2px 6px; border-radius: 4px; font-size: 0.85rem; }
`;
}
