import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type {
    AppConfig,
    SpotifyUploadConfig,
    SpotifyUploadState,
} from "./types.js";

const INSTALL_SCRIPT_URL = "https://saveto.spotify.com/install.sh";
const COMMAND_TIMEOUT_MS = 120_000;
const AUTH_URL_TIMEOUT_MS = 30_000;
const AUTH_COMPLETE_TIMEOUT_MS = 90_000;
const INSTALL_DOWNLOAD_TIMEOUT_MS = 30_000;
const VERSION_CHECK_TIMEOUT_MS = 8_000;

interface CommandResult {
    ok: boolean;
    code: number | null;
    stdout: string;
    stderr: string;
    json?: unknown;
    error?: string;
}

export interface SpotifyStatus {
    installed: boolean;
    authenticated: boolean;
    cliPath: string;
    version?: string;
    installedVersion?: string;
    latestVersion?: string;
    updateAvailable?: boolean;
    updateCheckError?: string;
    authStatus?: unknown;
    message?: string;
}

export interface SpotifyInstallResult {
    ok: boolean;
    cliPath: string;
    stdout: string;
    stderr: string;
    error?: string;
}

export interface SpotifyUpdateResult {
    ok: boolean;
    cliPath: string;
    stdout: string;
    stderr: string;
    error?: string;
}

export interface SpotifyAuthResult {
    ok: boolean;
    authUrl?: string;
    output: string;
    alreadyRunning?: boolean;
    error?: string;
}

interface ActiveSpotifyAuth {
    child: ChildProcessWithoutNullStreams;
    output: string;
    authUrl?: string;
    closePromise: Promise<CommandResult>;
}

let activeAuth: ActiveSpotifyAuth | null = null;

export function defaultSpotifyCliPath(config: AppConfig): string {
    const exe = process.platform === "win32" ? "save-to-spotify.exe" : "save-to-spotify";
    return join(resolve(config.data_dir), "bin", exe);
}

export function resolveSpotifyCliPath(config: AppConfig): string {
    const configured = config.spotify_upload?.cli_path?.trim() || "save-to-spotify";
    return expandHome(configured);
}

export async function getSpotifyStatus(config: AppConfig): Promise<SpotifyStatus> {
    const candidates = spotifyCliPathCandidates(config);
    let cliPath = candidates[0];
    let versionResult: CommandResult | undefined;

    for (const candidate of candidates) {
        const result = await runCommand(candidate, ["version"], {
            env: buildSpotifyEnv(config, candidate),
            timeoutMs: 15_000,
        });

        if (result.ok) {
            cliPath = candidate;
            versionResult = result;
            break;
        }

        versionResult ??= result;
    }

    if (!versionResult?.ok) {
        return {
            installed: false,
            authenticated: false,
            cliPath,
            message: versionResult
                ? normalizeCommandError("version", versionResult)
                : "save-to-spotify CLI was not found.",
        };
    }

    const authResult = await runCommand(cliPath, ["--json", "auth", "status"], {
        env: buildSpotifyEnv(config, cliPath),
        timeoutMs: 20_000,
    });
    const authenticated = authResult.ok && isSpotifyAuthenticated(authResult.json);
    const installedVersion = parseSaveToSpotifyVersion(versionResult.stdout);
    const latestVersionResult = await checkLatestSaveToSpotifyVersion(config, cliPath);
    const latestVersion = latestVersionResult.version;
    const updateAvailable = Boolean(
        installedVersion &&
        latestVersion &&
        compareVersions(installedVersion, latestVersion) < 0
    );

    return {
        installed: true,
        authenticated,
        cliPath,
        version: versionResult.stdout.trim() || undefined,
        installedVersion,
        latestVersion,
        updateAvailable,
        updateCheckError: latestVersionResult.error,
        authStatus: authResult.json,
        message: authenticated
            ? "Authenticated"
            : authResult.ok
                ? spotifyAuthStatusMessage(authResult.json)
                : normalizeCommandError("auth status", authResult),
    };
}

function spotifyCliPathCandidates(config: AppConfig): string[] {
    return uniqueStrings([
        resolveSpotifyCliPath(config),
        defaultSpotifyCliPath(config),
        "save-to-spotify",
    ]);
}

function uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];

    for (const value of values) {
        if (seen.has(value)) continue;
        seen.add(value);
        unique.push(value);
    }

    return unique;
}

async function checkLatestSaveToSpotifyVersion(
    config: AppConfig,
    cliPath: string
): Promise<{
    version?: string;
    error?: string;
}> {
    const cliResult = await runCommand(cliPath, ["--json", "update", "--check"], {
        env: buildSpotifyEnv(config, cliPath),
        timeoutMs: VERSION_CHECK_TIMEOUT_MS,
    });
    const cliVersion = parseLatestVersionFromUpdateCheck(cliResult.json);
    if (cliResult.ok && cliVersion) {
        return { version: cliVersion };
    }

    return {
        error: normalizeCommandError("update --check", cliResult),
    };
}

function parseLatestVersionFromUpdateCheck(value: unknown): string | undefined {
    if (!value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    const candidates = [
        record.latest_version,
        record.latestVersion,
        record.latest,
        record.version,
    ];

    for (const candidate of candidates) {
        if (typeof candidate !== "string") continue;
        const version = normalizeVersion(candidate);
        if (version) return version;
    }

    return undefined;
}

function parseSaveToSpotifyVersion(output: string): string | undefined {
    const match = output.match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/);
    return match ? normalizeVersion(match[1]) : undefined;
}

function normalizeVersion(version: string): string | undefined {
    const match = version.trim().match(/^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/);
    return match?.[1];
}

function compareVersions(left: string, right: string): number {
    const leftParts = versionNumbers(left);
    const rightParts = versionNumbers(right);

    for (let i = 0; i < 3; i++) {
        const diff = leftParts[i] - rightParts[i];
        if (diff !== 0) return diff;
    }

    return 0;
}

function versionNumbers(version: string): [number, number, number] {
    const [major = "0", minor = "0", patch = "0"] = version
        .split(/[+-]/, 1)[0]
        .split(".");

    return [
        Number.parseInt(major, 10) || 0,
        Number.parseInt(minor, 10) || 0,
        Number.parseInt(patch, 10) || 0,
    ];
}

export async function installSaveToSpotify(
    config: AppConfig
): Promise<SpotifyInstallResult> {
    const installDir = dirname(defaultSpotifyCliPath(config));
    const cliPath = defaultSpotifyCliPath(config);

    mkdirSync(installDir, { recursive: true });

    let script: string;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(),
            INSTALL_DOWNLOAD_TIMEOUT_MS
        );
        const response = await fetch(INSTALL_SCRIPT_URL, {
            signal: controller.signal,
        }).finally(() => clearTimeout(timeout));
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        script = await response.text();
    } catch (err) {
        const error = isAbortError(err)
            ? `Download timed out after ${INSTALL_DOWNLOAD_TIMEOUT_MS}ms`
            : formatError(err);
        return {
            ok: false,
            cliPath,
            stdout: "",
            stderr: "",
            error: `Failed to download installer: ${error}`,
        };
    }

    const result = await runCommand("bash", [
        "-s",
        "--",
        "--dir",
        installDir,
        "--no-skills",
    ], {
        input: script,
        env: buildSpotifyEnv(config, cliPath),
        timeoutMs: 180_000,
    });

    if (!result.ok) {
        return {
            ok: false,
            cliPath,
            stdout: result.stdout,
            stderr: result.stderr,
            error: normalizeCommandError("install", result),
        };
    }

    if (!existsSync(cliPath)) {
        return {
            ok: false,
            cliPath,
            stdout: result.stdout,
            stderr: result.stderr,
            error: `Installer completed, but ${cliPath} was not created.`,
        };
    }

    return {
        ok: true,
        cliPath,
        stdout: result.stdout,
        stderr: result.stderr,
    };
}

export async function updateSaveToSpotify(
    config: AppConfig
): Promise<SpotifyUpdateResult> {
    const cliPath = resolveSpotifyCliPath(config);
    const result = await runCommand(cliPath, ["update"], {
        env: buildSpotifyEnv(config, cliPath),
        timeoutMs: 180_000,
    });

    if (!result.ok) {
        return {
            ok: false,
            cliPath,
            stdout: result.stdout,
            stderr: result.stderr,
            error: normalizeCommandError("update", result),
        };
    }

    return {
        ok: true,
        cliPath,
        stdout: result.stdout,
        stderr: result.stderr,
    };
}

export async function startSpotifyHeadlessAuth(
    config: AppConfig
): Promise<SpotifyAuthResult> {
    if (activeAuth) {
        return {
            ok: true,
            authUrl: activeAuth.authUrl,
            output: activeAuth.output,
            alreadyRunning: true,
        };
    }

    const cliPath = resolveSpotifyCliPath(config);
    const child = spawn(cliPath, ["auth", "login", "--no-browser"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: buildSpotifyEnv(config, cliPath),
    });

    const session: ActiveSpotifyAuth = {
        child,
        output: "",
        closePromise: Promise.resolve({
            ok: false,
            code: null,
            stdout: "",
            stderr: "",
        }),
    };

    session.closePromise = new Promise<CommandResult>((resolveClose) => {
        child.on("close", (code) => {
            if (activeAuth === session) {
                activeAuth = null;
            }
            resolveClose({
                ok: code === 0,
                code,
                stdout: session.output,
                stderr: "",
            });
        });

        child.on("error", (err) => {
            if (activeAuth === session) {
                activeAuth = null;
            }
            resolveClose({
                ok: false,
                code: null,
                stdout: session.output,
                stderr: "",
                error: err.message,
            });
        });
    });

    activeAuth = session;

    return new Promise<SpotifyAuthResult>((resolveStart) => {
        let settled = false;

        const settle = (result: SpotifyAuthResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolveStart(result);
        };

        const appendOutput = (chunk: Buffer | string) => {
            const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
            session.output += text;

            const authUrl = extractAuthUrl(session.output);
            if (authUrl) {
                session.authUrl = authUrl;
                settle({
                    ok: true,
                    authUrl,
                    output: session.output,
                });
            }
        };

        const timer = setTimeout(() => {
            if (activeAuth === session) {
                activeAuth = null;
            }
            child.kill();
            settle({
                ok: false,
                output: session.output,
                error: "Timed out waiting for the authorization URL.",
            });
        }, AUTH_URL_TIMEOUT_MS);

        child.stdout.on("data", appendOutput);
        child.stderr.on("data", appendOutput);

        session.closePromise.then((result) => {
            if (session.authUrl) return;
            settle({
                ok: result.ok,
                output: result.stdout + result.stderr,
                error: result.ok ? undefined : normalizeCommandError("auth login", result),
            });
        });
    });
}

export async function completeSpotifyHeadlessAuth(
    config: AppConfig,
    redirectUrl: string
): Promise<SpotifyAuthResult> {
    const session = activeAuth;
    if (!session) {
        return {
            ok: false,
            output: "",
            error: "No active Spotify authentication session.",
        };
    }

    const trimmed = redirectUrl.trim();
    if (!trimmed) {
        return {
            ok: false,
            output: session.output,
            error: "Redirect URL is required.",
        };
    }

    try {
        session.child.stdin.write(trimmed + "\n");
        session.child.stdin.end();
    } catch (err) {
        return {
            ok: false,
            output: session.output,
            error: `Failed to submit redirect URL: ${formatError(err)}`,
        };
    }

    let result: CommandResult;
    try {
        result = await withTimeout(
            waitForAuthCompletion(config, session),
            AUTH_COMPLETE_TIMEOUT_MS,
            () => {
                if (activeAuth === session) {
                    activeAuth = null;
                }
                session.child.kill();
            }
        );
    } catch (err) {
        return {
            ok: false,
            authUrl: session.authUrl,
            output: session.output,
            error: formatError(err),
        };
    }

    return {
        ok: result.ok,
        authUrl: session.authUrl,
        output: result.stdout + result.stderr,
        error: result.ok ? undefined : normalizeCommandError("auth login", result),
    };
}

export function cancelSpotifyHeadlessAuth(): SpotifyAuthResult {
    const session = activeAuth;
    if (!session) {
        return {
            ok: true,
            output: "",
        };
    }

    activeAuth = null;
    session.child.kill();

    return {
        ok: true,
        authUrl: session.authUrl,
        output: session.output,
    };
}

export async function uploadEpisodeToSpotify(
    config: AppConfig,
    input: {
        filePath: string;
        title: string;
        source: string;
    }
): Promise<SpotifyUploadState> {
    const spotify = getSpotifyUploadConfig(config);
    const args = [
        "--json",
        "upload",
        input.filePath,
        "--title",
        input.title || "Untitled",
    ];

    const summary = formatSpotifySummary(config, input);
    if (summary) {
        args.push("--summary", summary);
    }

    if (spotify.show_id?.trim()) {
        args.push("--show-id", spotify.show_id.trim());
    } else if (spotify.new_show?.trim()) {
        args.push("--new-show", spotify.new_show.trim());
    }

    const language = spotify.language?.trim() || config.feed.language || "en";
    if (language) {
        args.push("--language", language);
    }

    if (spotify.image_path?.trim()) {
        args.push("--image", expandHome(spotify.image_path.trim()));
    }

    const result = await runSaveToSpotify(config, args, {
        timeoutMs: COMMAND_TIMEOUT_MS,
    });

    if (!result.ok) {
        throw new Error(normalizeCommandError("upload", result));
    }

    const state: SpotifyUploadState = {
        uploadedAt: new Date().toISOString(),
        episodeId: findStringValue(result.json, ["episode_id", "episodeId", "id"]),
        episodeUri: findStringValue(result.json, ["episode_uri", "episodeUri", "uri"]),
        showId: findStringValue(result.json, ["show_id", "showId"]),
    };

    if (spotify.wait_for_ready) {
        const episodeRef = state.episodeId ?? state.episodeUri;
        if (episodeRef) {
            const statusResult = await runSaveToSpotify(
                config,
                ["--json", "episodes", "status", episodeRef, "--wait"],
                { timeoutMs: 360_000 }
            );

            if (statusResult.ok) {
                state.readyStatus =
                    findStringValue(statusResult.json, ["status", "state"]) ?? "ready";
            } else {
                state.readyStatus = "unknown";
                state.error = normalizeCommandError("episodes status", statusResult);
            }
        }
    }

    return state;
}

function runSaveToSpotify(
    config: AppConfig,
    args: string[],
    options: { timeoutMs?: number } = {}
): Promise<CommandResult> {
    const cliPath = resolveSpotifyCliPath(config);
    return runCommand(cliPath, args, {
        env: buildSpotifyEnv(config, cliPath),
        timeoutMs: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    });
}

function runCommand(
    command: string,
    args: string[],
    options: {
        env?: NodeJS.ProcessEnv;
        input?: string;
        timeoutMs?: number;
    } = {}
): Promise<CommandResult> {
    return new Promise<CommandResult>((resolveCommand) => {
        const child = spawn(command, args, {
            stdio: ["pipe", "pipe", "pipe"],
            env: options.env,
        });

        let stdout = "";
        let stderr = "";
        let settled = false;

        const finish = (result: CommandResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolveCommand(result);
        };

        const timer = setTimeout(() => {
            child.kill();
            finish({
                ok: false,
                code: null,
                stdout,
                stderr,
                error: "Command timed out.",
            });
        }, options.timeoutMs ?? COMMAND_TIMEOUT_MS);

        child.stdout.on("data", (chunk: Buffer | string) => {
            stdout += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
        });

        child.stderr.on("data", (chunk: Buffer | string) => {
            stderr += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
        });

        child.on("error", (err) => {
            finish({
                ok: false,
                code: null,
                stdout,
                stderr,
                error: err.message,
            });
        });

        child.on("close", (code) => {
            finish({
                ok: code === 0,
                code,
                stdout,
                stderr,
                json: parseJsonOutput(stdout),
            });
        });

        if (options.input !== undefined) {
            child.stdin.write(options.input);
        }
        child.stdin.end();
    });
}

function buildSpotifyEnv(config: AppConfig, cliPath: string): NodeJS.ProcessEnv {
    const xdgConfigHome = process.env.XDG_CONFIG_HOME ||
        join(resolve(config.data_dir), "config");
    mkdirSync(xdgConfigHome, { recursive: true });

    const env: NodeJS.ProcessEnv = {
        ...process.env,
        XDG_CONFIG_HOME: xdgConfigHome,
        SAVE_TO_SPOTIFY_NO_UPDATE_CHECK:
            process.env.SAVE_TO_SPOTIFY_NO_UPDATE_CHECK ?? "1",
    };

    if (isAbsolute(cliPath)) {
        env.PATH = `${dirname(cliPath)}:${env.PATH ?? ""}`;
    }

    return env;
}

function formatSpotifySummary(
    config: AppConfig,
    input: { title: string; source: string }
): string {
    const configured = getSpotifyUploadConfig(config).summary?.trim();
    const template = configured || "Artikel från {{source}}";
    return template
        .replace(/\{\{title\}\}/g, input.title)
        .replace(/\{\{source\}\}/g, input.source || config.feed.author);
}

function parseJsonOutput(stdout: string): unknown | undefined {
    const trimmed = stdout.trim();
    if (!trimmed) return undefined;

    try {
        return JSON.parse(trimmed);
    } catch {
        const first = trimmed.indexOf("{");
        const last = trimmed.lastIndexOf("}");
        if (first >= 0 && last > first) {
            try {
                return JSON.parse(trimmed.slice(first, last + 1));
            } catch {
                return undefined;
            }
        }
        return undefined;
    }
}

function findStringValue(value: unknown, keys: string[]): string | undefined {
    if (!value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;

    for (const key of keys) {
        const candidate = record[key];
        if (typeof candidate === "string" && candidate.length > 0) {
            return candidate;
        }
    }

    for (const nested of Object.values(record)) {
        const candidate = findStringValue(nested, keys);
        if (candidate) return candidate;
    }

    return undefined;
}

function isSpotifyAuthenticated(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;

    if (record.authenticated !== true) return false;
    if (record.token_valid === false) return false;
    if (
        typeof record.expires_in_seconds === "number" &&
        record.expires_in_seconds <= 0
    ) {
        return false;
    }

    return true;
}

function spotifyAuthStatusMessage(value: unknown): string {
    if (!value || typeof value !== "object") return "Not authenticated";
    const record = value as Record<string, unknown>;

    if (
        record.authenticated === true &&
        typeof record.expires_in_seconds === "number" &&
        record.expires_in_seconds <= 0
    ) {
        return "Authentication expired";
    }

    if (record.token_valid === false) {
        return "Authentication token is invalid";
    }

    return "Not authenticated";
}

function extractAuthUrl(text: string): string | undefined {
    const urls = text.match(/https?:\/\/[^\s"'<>]+/g);
    if (!urls) return undefined;

    const preferred = urls.find((url) =>
        url.includes("accounts.spotify.com") ||
        url.includes("saveto.spotify.com")
    ) ?? urls[0];

    return preferred.replace(/[),.]+$/, "");
}

async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    onTimeout: () => void
): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_resolve, reject) => {
                timer = setTimeout(() => {
                    onTimeout();
                    reject(new Error("Command timed out."));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function waitForAuthCompletion(
    config: AppConfig,
    session: ActiveSpotifyAuth
): Promise<CommandResult> {
    return Promise.race([
        session.closePromise,
        waitForAuthenticatedStatus(config, session),
    ]);
}

async function waitForAuthenticatedStatus(
    config: AppConfig,
    session: ActiveSpotifyAuth
): Promise<CommandResult> {
    while (activeAuth === session) {
        await delay(1_000);

        const status = await getSpotifyStatus(config);
        if (!status.authenticated) continue;

        if (activeAuth === session) {
            activeAuth = null;
        }
        session.child.kill();

        return {
            ok: true,
            code: 0,
            stdout: session.output,
            stderr: "",
        };
    }

    return session.closePromise;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCommandError(command: string, result: CommandResult): string {
    const detail =
        result.error ||
        result.stderr.trim() ||
        result.stdout.trim() ||
        `exit code ${result.code}`;
    return `save-to-spotify ${command} failed: ${detail}`;
}

function expandHome(path: string): string {
    if (path === "~") return homedir();
    if (path.startsWith("~/")) {
        return join(homedir(), path.slice(2));
    }
    return path;
}

function formatError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function isAbortError(err: unknown): boolean {
    return err instanceof Error && err.name === "AbortError";
}

function getSpotifyUploadConfig(config: AppConfig): SpotifyUploadConfig {
    return {
        enabled: false,
        cli_path: "save-to-spotify",
        language: config.feed.language || "en",
        wait_for_ready: false,
        ...(config.spotify_upload ?? {}),
    };
}
