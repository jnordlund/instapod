import { Router } from "express";
import { unlinkSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppConfig } from "./types.js";
import { StateManager } from "./state.js";
import { saveConfig } from "./config.js";
import {
  createIpFilter,
  createAuthGuard,
  handleLogin,
  handleSetup,
  handleLogout,
} from "./admin-auth.js";

/**
 * Create an Express Router with admin UI + API routes.
 */
export function createAdminRouter(
  getConfig: () => AppConfig,
  setConfig: (c: AppConfig) => void,
  state: StateManager,
  triggerRun: () => Promise<void>
): Router {
  const router = Router();

  // ── Auth middleware (applied to all /admin and /api/* routes) ──
  router.use(["/admin", "/api"], createIpFilter(getConfig));
  router.use(["/admin", "/api"], createAuthGuard(getConfig));

  // ── Auth routes ──
  router.post("/api/admin/login", (req, res) => handleLogin(req, res, getConfig));
  router.post("/api/admin/setup", (req, res) => handleSetup(req, res, getConfig, setConfig, saveConfig));
  router.post("/api/admin/logout", (req, res) => handleLogout(req, res));

  // ── Admin page ──
  router.get("/admin", (_req, res) => {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(renderAdminPage());
  });

  // ── API: Get config (credentials masked) ──
  router.get("/api/config", (_req, res) => {
    const config = getConfig();
    const masked = JSON.parse(JSON.stringify(config));
    masked.instapaper.password = "••••••••";
    masked.instapaper.consumer_secret = "••••••••";
    masked.translation.api_key = "••••••••";
    if (masked.admin) {
      masked.admin.password = "••••••••";
      delete masked.admin.session_secret;
    }
    res.json(masked);
  });

  // ── API: Update config ──
  router.put("/api/config", (req, res) => {
    try {
      const updates = req.body as Partial<AppConfig>;
      const current = getConfig();

      // Deep merge updates into current config
      const merged = deepMerge(
        JSON.parse(JSON.stringify(current)),
        updates
      ) as AppConfig;

      // Don't overwrite masked fields
      if (updates.instapaper?.password === "••••••••") {
        merged.instapaper.password = current.instapaper.password;
      }
      if (updates.instapaper?.consumer_secret === "••••••••") {
        merged.instapaper.consumer_secret = current.instapaper.consumer_secret;
      }
      if (updates.translation?.api_key === "••••••••") {
        merged.translation.api_key = current.translation.api_key;
      }
      // Preserve admin secrets
      if (merged.admin) {
        if (updates.admin?.password === "••••••••") {
          merged.admin.password = current.admin?.password;
        }
        merged.admin.session_secret = current.admin?.session_secret;
      }

      saveConfig(merged);
      setConfig(merged);

      res.json({ status: "ok", message: "Configuration saved" });
    } catch (err) {
      console.error("[admin] Failed to save config:", err);
      res.status(500).json({ error: "Failed to save configuration" });
    }
  });

  // ── API: List episodes ──
  router.get("/api/episodes", (_req, res) => {
    const episodes = state.getProcessedBookmarks();
    res.json(episodes);
  });

  // ── API: Delete episode ──
  router.delete("/api/episodes/:id", (req, res) => {
    const bookmarkId = req.params.id;
    const config = getConfig();
    const episodes = state.getProcessedBookmarks();
    const episode = episodes.find((e) => e.bookmarkId === bookmarkId);

    if (!episode) {
      return res.status(404).json({ error: "Episode not found" });
    }

    // Delete audio file
    const audioPath = join(resolve(config.data_dir), "audio", episode.filename);
    if (existsSync(audioPath)) {
      try {
        unlinkSync(audioPath);
      } catch (err) {
        console.error("[admin] Failed to delete audio:", err);
      }
    }

    // Remove from state
    state.removeProcessed(bookmarkId);

    res.json({ status: "ok", message: "Episode deleted" });
  });

  // ── API: Pipeline status ──
  router.get("/api/status", (_req, res) => {
    const episodes = state.getProcessedBookmarks();
    res.json({
      episodeCount: episodes.length,
      lastRun: state.getLastRun(),
    });
  });

  // ── API: Trigger pipeline ──
  router.post("/api/trigger", (_req, res) => {
    res.json({ status: "started", message: "Pipeline run triggered" });
    triggerRun().catch((err) =>
      console.error("[admin] Triggered run failed:", err)
    );
  });

  return router;
}

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object"
    ) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// ── HTML Template ──

function renderAdminPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Instapod Admin</title>
<style>
:root {
  --bg: #0f1117;
  --surface: #1a1d27;
  --surface2: #242837;
  --border: #2e3348;
  --text: #e1e4ed;
  --text2: #8b90a5;
  --accent: #6c63ff;
  --accent2: #8b83ff;
  --danger: #ef4444;
  --success: #22c55e;
  --warning: #f59e0b;
  --radius: 12px;
  --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  min-height: 100vh;
}
.container {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 20px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 32px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
}
header h1 {
  font-size: 1.5rem;
  font-weight: 700;
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 500;
}
.badge.ok { background: rgba(34,197,94,0.15); color: var(--success); }
.badge.running { background: rgba(108,99,255,0.15); color: var(--accent2); }

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
  margin-bottom: 20px;
}
.card h2 {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.card h2 .icon { font-size: 1.2rem; }

/* Status bar */
.status-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}
.stat {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px 20px;
}
.stat .label { font-size: 0.8rem; color: var(--text2); margin-bottom: 4px; }
.stat .value { font-size: 1.4rem; font-weight: 700; }

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border: none;
  border-radius: 8px;
  font-family: var(--font);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn:hover { transform: translateY(-1px); }
.btn:active { transform: translateY(0); }
.btn-primary {
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  color: #fff;
}
.btn-primary:hover { box-shadow: 0 4px 16px rgba(108,99,255,0.3); }
.btn-danger { background: var(--danger); color: #fff; }
.btn-danger:hover { box-shadow: 0 4px 16px rgba(239,68,68,0.3); }
.btn-ghost {
  background: transparent;
  color: var(--text2);
  border: 1px solid var(--border);
}
.btn-ghost:hover { background: var(--surface2); color: var(--text); }
.btn-sm { padding: 5px 12px; font-size: 0.78rem; }

/* Form elements */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
@media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }
.form-group { display: flex; flex-direction: column; gap: 4px; }
.form-group.full { grid-column: 1 / -1; }
.form-group label {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text2);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.form-group input, .form-group select {
  padding: 9px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-family: var(--font);
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.15s;
}
.form-group input:focus, .form-group select:focus {
  border-color: var(--accent);
}
.form-help {
  margin-top: 4px;
  font-size: 0.75rem;
  color: var(--text2);
}

/* Episode list */
.episode-list { list-style: none; }
.episode-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}
.episode-item:last-child { border-bottom: none; }
.episode-info { flex: 1; min-width: 0; }
.episode-title {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.episode-meta {
  font-size: 0.8rem;
  color: var(--text2);
  display: flex;
  gap: 12px;
  margin-top: 2px;
}
.episode-actions { display: flex; gap: 6px; flex-shrink: 0; }

/* Toast */
.toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  padding: 12px 20px;
  border-radius: 10px;
  font-size: 0.85rem;
  font-weight: 500;
  color: #fff;
  opacity: 0;
  transform: translateY(10px);
  transition: all 0.3s ease;
  z-index: 100;
}
.toast.show { opacity: 1; transform: translateY(0); }
.toast.success { background: var(--success); }
.toast.error { background: var(--danger); }

/* Section toggle */
.section-header {
  cursor: pointer;
  user-select: none;
}
.section-header::after {
  content: '▾';
  margin-left: auto;
  font-size: 0.9rem;
  color: var(--text2);
  transition: transform 0.2s;
}
.section-header.collapsed::after { transform: rotate(-90deg); }

/* Tabs */
.tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 20px;
  background: var(--surface);
  border-radius: var(--radius);
  padding: 4px;
  border: 1px solid var(--border);
}
.tab {
  flex: 1;
  padding: 10px;
  text-align: center;
  font-size: 0.85rem;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text2);
  transition: all 0.2s;
}
.tab:hover { color: var(--text); }
.tab.active {
  background: var(--accent);
  color: #fff;
}
.tab-content { display: none; }
.tab-content.active { display: block; }

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--text2);
}
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>🎙️ Instapod</h1>
    <div style="display:flex;gap:10px;align-items:center;">
      <span class="badge ok" id="statusBadge">● Online</span>
      <button class="btn btn-ghost btn-sm" onclick="doLogout()">Logout</button>
    </div>
  </header>

  <!-- Status bar -->
  <div class="status-bar">
    <div class="stat">
      <div class="label">Episodes</div>
      <div class="value" id="episodeCount">—</div>
    </div>
    <div class="stat">
      <div class="label">Last Run</div>
      <div class="value" id="lastRun">—</div>
    </div>
    <div class="stat">
      <div class="label">Actions</div>
      <div class="value">
        <button class="btn btn-primary btn-sm" onclick="triggerPipeline()" id="triggerBtn">
          ▶ Run Now
        </button>
      </div>
    </div>
  </div>

  <!-- Tabs -->
  <div class="tabs">
    <div class="tab active" onclick="switchTab('episodes')">Episodes</div>
    <div class="tab" onclick="switchTab('config')">Configuration</div>
  </div>

  <!-- Episodes tab -->
  <div class="tab-content active" id="tab-episodes">
    <div class="card">
      <h2><span class="icon">🎧</span> Episodes</h2>
      <ul class="episode-list" id="episodeList">
        <li class="empty-state">Loading...</li>
      </ul>
    </div>
  </div>

  <!-- Config tab -->
  <div class="tab-content" id="tab-config">

    <!-- Instapaper -->
    <div class="card">
      <h2><span class="icon">📑</span> Instapaper</h2>
      <div class="form-grid">
        <div class="form-group">
          <label>Username</label>
          <input type="text" id="cfg-instapaper-username">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="cfg-instapaper-password">
        </div>
        <div class="form-group">
          <label>Consumer Key</label>
          <input type="text" id="cfg-instapaper-consumer_key">
        </div>
        <div class="form-group">
          <label>Consumer Secret</label>
          <input type="password" id="cfg-instapaper-consumer_secret">
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="card">
      <h2><span class="icon">🏷️</span> Filters</h2>
      <div class="form-grid">
        <div class="form-group full">
          <label>Tags (comma-separated)</label>
          <input type="text" id="cfg-filters-tags" placeholder="e.g. pod, tech">
        </div>
      </div>
    </div>

    <!-- Translation -->
    <div class="card">
      <h2><span class="icon">🌐</span> Translation</h2>
      <div class="form-grid">
        <div class="form-group">
          <label>API Base URL</label>
          <input type="url" id="cfg-translation-api_base">
        </div>
        <div class="form-group">
          <label>API Key</label>
          <input type="password" id="cfg-translation-api_key">
        </div>
        <div class="form-group">
          <label>Model</label>
          <input type="text" id="cfg-translation-model">
        </div>
        <div class="form-group">
          <label>Target Language</label>
          <input type="text" id="cfg-translation-target_language">
        </div>
      </div>
    </div>

    <!-- TTS -->
    <div class="card">
      <h2><span class="icon">🗣️</span> Text-to-Speech</h2>
      <div class="form-grid">
        <div class="form-group">
          <label>Voice</label>
          <input type="text" id="cfg-tts-voice" placeholder="sv-SE-SofieNeural">
        </div>
        <div class="form-group">
          <label>Rate</label>
          <input type="text" id="cfg-tts-rate" placeholder="+0%">
        </div>
        <div class="form-group">
          <label>Pitch</label>
          <input type="text" id="cfg-tts-pitch" placeholder="+0Hz">
        </div>
      </div>
    </div>

    <!-- Schedule -->
    <div class="card">
      <h2><span class="icon">⏰</span> Schedule</h2>
      <div class="form-grid">
        <div class="form-group">
          <label>Run Frequency</label>
          <select id="cfg-schedule-preset" onchange="onSchedulePresetChange()">
            <option value="*/5 * * * *">Every 5 minutes</option>
            <option value="*/15 * * * *">Every 15 minutes</option>
            <option value="*/30 * * * *">Every 30 minutes</option>
            <option value="0 * * * *">Every hour</option>
            <option value="0 */6 * * *">Every 6 hours</option>
            <option value="daily">Daily (choose time)</option>
            <option value="custom">Custom cron</option>
          </select>
        </div>
        <div class="form-group" id="cfg-schedule-daily-group" style="display:none;">
          <label>Daily Time</label>
          <input type="time" id="cfg-schedule-daily-time" value="08:00" onchange="onSchedulePresetChange()">
        </div>
        <div class="form-group full">
          <label>Cron Expression (Advanced)</label>
          <input type="text" id="cfg-schedule-cron" placeholder="*/30 * * * *" oninput="onScheduleCronInput()">
          <div class="form-help" id="cfg-schedule-help">Choose a frequency above, or use custom cron.</div>
        </div>
      </div>
    </div>

    <!-- Server & Feed -->
    <div class="card">
      <h2><span class="icon">📡</span> Server &amp; Feed</h2>
      <div class="form-grid">
        <div class="form-group">
          <label>Port</label>
          <input type="number" id="cfg-server-port">
        </div>
        <div class="form-group">
          <label>Base URL</label>
          <input type="url" id="cfg-server-base_url">
        </div>
        <div class="form-group">
          <label>Feed Title</label>
          <input type="text" id="cfg-feed-title">
        </div>
        <div class="form-group">
          <label>Feed Author</label>
          <input type="text" id="cfg-feed-author">
        </div>
        <div class="form-group full">
          <label>Feed Description</label>
          <input type="text" id="cfg-feed-description">
        </div>
        <div class="form-group">
          <label>Language</label>
          <input type="text" id="cfg-feed-language" placeholder="sv">
        </div>
        <div class="form-group">
          <label>Image URL</label>
          <input type="url" id="cfg-feed-image" placeholder="https://...">
        </div>
      </div>
    </div>

    <!-- Admin / Access Control -->
    <div class="card">
      <h2><span class="icon">🔒</span> Access Control</h2>
      <div class="form-grid">
        <div class="form-group">
          <label>Admin Password</label>
          <input type="password" id="cfg-admin-password">
        </div>
        <div class="form-group full">
          <label>Allowed CIDRs (one per line)</label>
          <textarea id="cfg-admin-cidrs" rows="4" style="padding:9px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:var(--font);font-size:0.9rem;outline:none;resize:vertical;width:100%;" placeholder="10.0.0.0/8&#10;172.16.0.0/12&#10;192.168.0.0/16&#10;127.0.0.0/8"></textarea>
        </div>
      </div>
    </div>

    <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:8px; margin-bottom:20px;">
      <button class="btn btn-ghost" onclick="loadConfig()">Discard</button>
      <button class="btn btn-primary" onclick="saveConfigForm()" id="saveBtn">💾 Save Configuration</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
// ── State ──
let currentConfig = null;

// ── Tab switching ──
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('active', t.textContent.toLowerCase().includes(name));
  });
  document.querySelectorAll('.tab-content').forEach(tc => {
    tc.classList.toggle('active', tc.id === 'tab-' + name);
  });
}

// ── Toast notifications ──
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + type + ' show';
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Format helpers ──
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return d.toLocaleDateString('sv-SE') + ' ' + d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

// ── API calls ──
async function apiFetch(url, opts = {}) {
  const r = await fetch(url, { credentials: 'include', ...opts });
  if (r.status === 401) { window.location.href = '/admin'; throw new Error('auth'); }
  return r;
}

async function loadStatus() {
  try {
    const r = await apiFetch('/api/status');
    const data = await r.json();
    document.getElementById('episodeCount').textContent = data.episodeCount;
    document.getElementById('lastRun').textContent = formatDate(data.lastRun);
  } catch (e) {
    if (e.message !== 'auth') console.error('Failed to load status:', e);
  }
}

async function loadEpisodes() {
  try {
    const r = await apiFetch('/api/episodes');
    const episodes = await r.json();
    const list = document.getElementById('episodeList');

    if (episodes.length === 0) {
      list.innerHTML = '<li class="empty-state">No episodes yet. Tag an article in Instapaper to get started.</li>';
      return;
    }

    list.innerHTML = episodes.map(ep => \`
      <li class="episode-item">
        <div class="episode-info">
          <div class="episode-title">\${escapeHtml(ep.title)}</div>
          <div class="episode-meta">
            <span>⏱ \${formatDuration(ep.duration)}</span>
            <span>📅 \${formatDate(ep.pubDate)}</span>
            <span>🔗 \${escapeHtml(ep.source || '')}</span>
          </div>
        </div>
        <div class="episode-actions">
          <button class="btn btn-ghost btn-sm" onclick="playEpisode('\${ep.filename}')">▶</button>
          <button class="btn btn-danger btn-sm" onclick="deleteEpisode('\${ep.bookmarkId}', this)">✕</button>
        </div>
      </li>
    \`).join('');
  } catch (e) {
    console.error('Failed to load episodes:', e);
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function playEpisode(filename) {
  window.open('/audio/' + encodeURIComponent(filename), '_blank');
}

async function deleteEpisode(id, btn) {
  if (!confirm('Delete this episode?')) return;
  btn.disabled = true;
  try {
    const r = await apiFetch('/api/episodes/' + id, { method: 'DELETE' });
    if (r.ok) {
      showToast('Episode deleted');
      loadEpisodes();
      loadStatus();
    } else {
      showToast('Failed to delete', 'error');
    }
  } catch (e) {
    showToast('Network error', 'error');
  }
}

async function triggerPipeline() {
  const btn = document.getElementById('triggerBtn');
  btn.innerHTML = '<span class="spinner"></span> Running...';
  btn.disabled = true;
  try {
    await apiFetch('/api/trigger', { method: 'POST' });
    showToast('Pipeline triggered');
  } catch (e) {
    showToast('Failed to trigger', 'error');
  }
  setTimeout(() => {
    btn.innerHTML = '▶ Run Now';
    btn.disabled = false;
    loadStatus();
    loadEpisodes();
  }, 5000);
}

// ── Config form ──
async function loadConfig() {
  try {
    const r = await apiFetch('/api/config');
    currentConfig = await r.json();
    populateForm(currentConfig);
  } catch (e) {
    showToast('Failed to load config', 'error');
  }
}

const FIXED_SCHEDULE_PRESETS = [
  '*/5 * * * *',
  '*/15 * * * *',
  '*/30 * * * *',
  '0 * * * *',
  '0 */6 * * *',
];

function cronFromDailyTime(timeValue) {
  const parts = String(timeValue || '08:00').split(':');
  const rawHour = Number.parseInt(parts[0], 10);
  const rawMinute = Number.parseInt(parts[1], 10);
  const hour = Number.isFinite(rawHour) ? Math.min(23, Math.max(0, rawHour)) : 8;
  const minute = Number.isFinite(rawMinute) ? Math.min(59, Math.max(0, rawMinute)) : 0;
  return String(minute) + ' ' + String(hour) + ' * * *';
}

function parseDailyCron(cronExpr) {
  const match = String(cronExpr || '').trim().match(/^([0-5]?\\d)\\s+([01]?\\d|2[0-3])\\s+\\*\\s+\\*\\s+\\*$/);
  if (!match) return null;
  const minute = Number.parseInt(match[1], 10);
  const hour = Number.parseInt(match[2], 10);
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function getSchedulePresetHint(preset) {
  switch (preset) {
    case '*/5 * * * *':
      return 'Runs every 5 minutes.';
    case '*/15 * * * *':
      return 'Runs every 15 minutes.';
    case '*/30 * * * *':
      return 'Runs every 30 minutes.';
    case '0 * * * *':
      return 'Runs every hour on the hour.';
    case '0 */6 * * *':
      return 'Runs every 6 hours.';
    case 'daily':
      return 'Runs once per day at the selected time.';
    default:
      return 'Custom cron mode. Example: */30 * * * *';
  }
}

function onSchedulePresetChange() {
  const preset = getValue('cfg-schedule-preset');
  const cronEl = document.getElementById('cfg-schedule-cron');
  const dailyGroup = document.getElementById('cfg-schedule-daily-group');
  const helpEl = document.getElementById('cfg-schedule-help');
  if (!cronEl || !dailyGroup || !helpEl) return;

  if (preset === 'custom') {
    dailyGroup.style.display = 'none';
    cronEl.readOnly = false;
    helpEl.textContent = getSchedulePresetHint(preset);
    return;
  }

  cronEl.readOnly = true;

  if (preset === 'daily') {
    dailyGroup.style.display = '';
    cronEl.value = cronFromDailyTime(getValue('cfg-schedule-daily-time'));
    helpEl.textContent = getSchedulePresetHint(preset);
    return;
  }

  dailyGroup.style.display = 'none';
  cronEl.value = preset;
  helpEl.textContent = getSchedulePresetHint(preset);
}

function onScheduleCronInput() {
  const presetEl = document.getElementById('cfg-schedule-preset');
  if (!presetEl) return;
  if (presetEl.value !== 'custom') {
    presetEl.value = 'custom';
    onSchedulePresetChange();
  }
}

function syncScheduleUiFromCron(cronExpr) {
  const normalized = String(cronExpr || '').trim() || '*/30 * * * *';
  setValue('cfg-schedule-cron', normalized);

  const presetEl = document.getElementById('cfg-schedule-preset');
  if (!presetEl) return;

  if (FIXED_SCHEDULE_PRESETS.includes(normalized)) {
    presetEl.value = normalized;
    onSchedulePresetChange();
    return;
  }

  const dailyTime = parseDailyCron(normalized);
  if (dailyTime) {
    presetEl.value = 'daily';
    setValue('cfg-schedule-daily-time', dailyTime);
    onSchedulePresetChange();
    return;
  }

  presetEl.value = 'custom';
  onSchedulePresetChange();
  setValue('cfg-schedule-cron', normalized);
}

function populateForm(c) {
  setValue('cfg-instapaper-username', c.instapaper?.username);
  setValue('cfg-instapaper-password', c.instapaper?.password);
  setValue('cfg-instapaper-consumer_key', c.instapaper?.consumer_key);
  setValue('cfg-instapaper-consumer_secret', c.instapaper?.consumer_secret);
  setValue('cfg-filters-tags', (c.filters?.tags || []).join(', '));
  setValue('cfg-translation-api_base', c.translation?.api_base);
  setValue('cfg-translation-api_key', c.translation?.api_key);
  setValue('cfg-translation-model', c.translation?.model);
  setValue('cfg-translation-target_language', c.translation?.target_language);
  setValue('cfg-tts-voice', c.tts?.voice);
  setValue('cfg-tts-rate', c.tts?.rate);
  setValue('cfg-tts-pitch', c.tts?.pitch);
  syncScheduleUiFromCron(c.schedule?.cron);
  setValue('cfg-server-port', c.server?.port);
  setValue('cfg-server-base_url', c.server?.base_url);
  setValue('cfg-feed-title', c.feed?.title);
  setValue('cfg-feed-author', c.feed?.author);
  setValue('cfg-feed-description', c.feed?.description);
  setValue('cfg-feed-language', c.feed?.language);
  setValue('cfg-feed-image', c.feed?.image);
  setValue('cfg-admin-password', c.admin?.password);
  const cidrsEl = document.getElementById('cfg-admin-cidrs');
  if (cidrsEl) cidrsEl.value = (c.admin?.allowed_cidrs || []).join('\\n');
}

function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val ?? '';
}
function getValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

async function saveConfigForm() {
  const btn = document.getElementById('saveBtn');
  btn.innerHTML = '<span class="spinner"></span> Saving...';
  btn.disabled = true;

  const tags = getValue('cfg-filters-tags')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
  onSchedulePresetChange();
  const cronExpr = getValue('cfg-schedule-cron').trim() || '*/30 * * * *';

  const update = {
    instapaper: {
      username: getValue('cfg-instapaper-username'),
      password: getValue('cfg-instapaper-password'),
      consumer_key: getValue('cfg-instapaper-consumer_key'),
      consumer_secret: getValue('cfg-instapaper-consumer_secret'),
    },
    filters: { tags },
    translation: {
      api_base: getValue('cfg-translation-api_base'),
      api_key: getValue('cfg-translation-api_key'),
      model: getValue('cfg-translation-model'),
      target_language: getValue('cfg-translation-target_language'),
      skip_if_same: currentConfig?.translation?.skip_if_same ?? true,
    },
    tts: {
      voice: getValue('cfg-tts-voice'),
      rate: getValue('cfg-tts-rate'),
      pitch: getValue('cfg-tts-pitch'),
    },
    schedule: { cron: cronExpr },
    server: {
      port: parseInt(getValue('cfg-server-port'), 10) || 8080,
      base_url: getValue('cfg-server-base_url'),
    },
    feed: {
      title: getValue('cfg-feed-title'),
      description: getValue('cfg-feed-description'),
      language: getValue('cfg-feed-language'),
      author: getValue('cfg-feed-author'),
      image: getValue('cfg-feed-image') || undefined,
    },
    admin: {
      password: getValue('cfg-admin-password'),
      allowed_cidrs: document.getElementById('cfg-admin-cidrs').value
        .split('\\n').map(s => s.trim()).filter(Boolean),
    },
    data_dir: currentConfig?.data_dir ?? '/data',
  };

  try {
    const r = await apiFetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    });
    if (r.ok) {
      showToast('Configuration saved');
      loadConfig();
    } else {
      showToast('Failed to save', 'error');
    }
  } catch (e) {
    showToast('Network error', 'error');
  } finally {
    btn.innerHTML = '💾 Save Configuration';
    btn.disabled = false;
  }
}

// ── Logout ──
async function doLogout() {
  await fetch('/api/admin/logout', { method: 'POST' });
  window.location.href = '/admin';
}

// ── Init ──
loadStatus();
loadEpisodes();
loadConfig();
setInterval(loadStatus, 30000);
</script>
</body>
</html>`;
}
