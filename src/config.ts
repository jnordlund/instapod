import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import cron from "node-cron";
import type { AppConfig } from "./types.js";
import { FEED_ACCESS_TOKEN_PATTERN } from "./feed-access.js";
import {
    DEFAULT_TEXT_PROMPT_TEMPLATE,
    DEFAULT_TITLE_PROMPT_TEMPLATE,
} from "./translation-prompts.js";

export class ConfigValidationError extends Error {
    constructor(public readonly issues: string[]) {
        super(`Invalid config: ${issues.join("; ")}`);
        this.name = "ConfigValidationError";
    }
}

export type ConfigValidationMode = "draft" | "runnable";

export interface ConfigValidationOptions {
    mode?: ConfigValidationMode;
}

const RUNNABLE_REQUIRED_STRING_FIELDS = [
    "instapaper.consumer_key",
    "instapaper.consumer_secret",
    "instapaper.username",
    "instapaper.password",
    "translation.api_key",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split(".").reduce<unknown>((acc, key) => {
        if (acc && typeof acc === "object") {
            return (acc as Record<string, unknown>)[key];
        }
        return undefined;
    }, obj);
}

function isMissing(value: unknown): boolean {
    return value === undefined || value === null || value === "";
}

function applyEnvOverrides(config: Record<string, unknown>): void {
    const envMap: Record<string, string> = {
        INSTAPAPER_CONSUMER_KEY: "instapaper.consumer_key",
        INSTAPAPER_CONSUMER_SECRET: "instapaper.consumer_secret",
        INSTAPAPER_USERNAME: "instapaper.username",
        INSTAPAPER_PASSWORD: "instapaper.password",
        TRANSLATION_API_BASE: "translation.api_base",
        TRANSLATION_API_KEY: "translation.api_key",
        TRANSLATION_MODEL: "translation.model",
        TRANSLATION_TARGET_LANGUAGE: "translation.target_language",
        TTS_VOICE: "tts.voice",
        SPOTIFY_UPLOAD_ENABLED: "spotify_upload.enabled",
        SPOTIFY_UPLOAD_CLI_PATH: "spotify_upload.cli_path",
        SPOTIFY_UPLOAD_SHOW_ID: "spotify_upload.show_id",
        SPOTIFY_UPLOAD_NEW_SHOW: "spotify_upload.new_show",
        SPOTIFY_UPLOAD_LANGUAGE: "spotify_upload.language",
        SPOTIFY_UPLOAD_SUMMARY: "spotify_upload.summary",
        SPOTIFY_UPLOAD_IMAGE_PATH: "spotify_upload.image_path",
        SPOTIFY_UPLOAD_WAIT_FOR_READY: "spotify_upload.wait_for_ready",
        FEED_ACCESS_ENABLED: "feed_access.enabled",
        FEED_ACCESS_TOKEN: "feed_access.token",
        SERVER_PORT: "server.port",
        SERVER_BASE_URL: "server.base_url",
        DATA_DIR: "data_dir",
    };

    for (const [envKey, configPath] of Object.entries(envMap)) {
        const envValue = process.env[envKey];
        if (envValue === undefined) continue;

        const parts = configPath.split(".");
        let target = config;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!target[parts[i]] || typeof target[parts[i]] !== "object") {
                target[parts[i]] = {};
            }
            target = target[parts[i]] as Record<string, unknown>;
        }

        const lastKey = parts[parts.length - 1];
        if (configPath === "server.port") {
            target[lastKey] = parseInt(envValue, 10);
        } else if (
            configPath === "spotify_upload.enabled" ||
            configPath === "spotify_upload.wait_for_ready" ||
            configPath === "feed_access.enabled"
        ) {
            target[lastKey] = parseBoolean(envValue);
        } else {
            target[lastKey] = envValue;
        }
    }
}

function parseBoolean(value: string): boolean {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

const DEFAULTS: Partial<Record<string, unknown>> = {
    "instapaper.consumer_key": "",
    "instapaper.consumer_secret": "",
    "instapaper.username": "",
    "instapaper.password": "",
    "filters.tags": [],
    "translation.api_base": "https://api.openai.com/v1",
    "translation.api_key": "",
    "translation.model": "gpt-4o-mini",
    "translation.target_language": "svenska",
    "translation.skip_if_same": true,
    "translation.title_prompt": DEFAULT_TITLE_PROMPT_TEMPLATE,
    "translation.text_prompt": DEFAULT_TEXT_PROMPT_TEMPLATE,
    "tts.voice": "sv-SE-SofieNeural",
    "tts.rate": "+0%",
    "tts.pitch": "+0Hz",
    "spotify_upload.enabled": false,
    "spotify_upload.cli_path": "save-to-spotify",
    "spotify_upload.language": "sv",
    "spotify_upload.wait_for_ready": false,
    "schedule.cron": "*/30 * * * *",
    "server.port": 8080,
    "server.base_url": "",
    "feed.title": "Instapod",
    "feed.description": "Artiklar upplästa som podcast",
    "feed.language": "sv",
    "feed.author": "Instapod",
    "feed_access.enabled": false,
    "feed_access.token": "",
    "admin.allowed_cidrs": [
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "127.0.0.0/8",
        "::1/128",
    ],
    "data_dir": "/data",
};

function applyDefaults(config: Record<string, unknown>): void {
    for (const [path, defaultValue] of Object.entries(DEFAULTS)) {
        const current = getNestedValue(config, path);
        if (current !== undefined) continue;

        const parts = path.split(".");
        let target = config;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!target[parts[i]] || typeof target[parts[i]] !== "object") {
                target[parts[i]] = {};
            }
            target = target[parts[i]] as Record<string, unknown>;
        }
        target[parts[parts.length - 1]] = defaultValue;
    }
}

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

function requireString(
    config: Record<string, unknown>,
    path: string,
    issues: string[],
    missing: string[]
): void {
    const value = getNestedValue(config, path);
    if (isMissing(value)) {
        missing.push(path);
        return;
    }
    if (typeof value !== "string") {
        issues.push(`${path} must be a string`);
    }
}

function optionalString(
    config: Record<string, unknown>,
    path: string,
    issues: string[],
    options: { allowEmpty?: boolean; minLength?: number } = {}
): void {
    const value = getNestedValue(config, path);
    if (value === undefined) return;
    if (typeof value !== "string") {
        issues.push(`${path} must be a string`);
        return;
    }
    if (value.length === 0 && options.allowEmpty === false) {
        issues.push(`${path} must not be empty`);
        return;
    }
    if (options.minLength !== undefined && value.length > 0 && value.length < options.minLength) {
        issues.push(`${path} must be at least ${options.minLength} characters`);
    }
}

function requireBoolean(
    config: Record<string, unknown>,
    path: string,
    issues: string[]
): void {
    const value = getNestedValue(config, path);
    if (typeof value !== "boolean") {
        issues.push(`${path} must be a boolean`);
    }
}

function requireStringArray(
    config: Record<string, unknown>,
    path: string,
    issues: string[]
): void {
    const value = getNestedValue(config, path);
    if (!Array.isArray(value)) {
        issues.push(`${path} must be an array of strings`);
        return;
    }
    if (value.some((item) => typeof item !== "string")) {
        issues.push(`${path} must be an array of strings`);
    }
}

function optionalStringArray(
    config: Record<string, unknown>,
    path: string,
    issues: string[]
): void {
    const value = getNestedValue(config, path);
    if (value === undefined) return;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        issues.push(`${path} must be an array of strings`);
    }
}

function rejectUnknownKeys(
    config: Record<string, unknown>,
    path: string,
    allowedKeys: readonly string[],
    issues: string[]
): void {
    const value = path ? getNestedValue(config, path) : config;
    if (value === undefined || !isRecord(value)) return;

    const allowed = new Set(allowedKeys);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            issues.push(`${path ? `${path}.` : ""}${key} is not a supported config key`);
        }
    }
}

function requirePort(
    config: Record<string, unknown>,
    path: string,
    issues: string[]
): void {
    const value = getNestedValue(config, path);
    if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 65535
    ) {
        issues.push(`${path} must be an integer between 1 and 65535`);
    }
}

function requireHttpUrl(
    config: Record<string, unknown>,
    path: string,
    issues: string[]
): void {
    const value = getNestedValue(config, path);
    if (typeof value !== "string" || !isHttpUrl(value)) {
        issues.push(`${path} must be an http(s) URL`);
    }
}

function optionalHttpUrl(
    config: Record<string, unknown>,
    path: string,
    issues: string[]
): void {
    const value = getNestedValue(config, path);
    if (value === undefined || value === "") return;
    if (typeof value !== "string" || !isHttpUrl(value)) {
        issues.push(`${path} must be an http(s) URL`);
    }
}

function requireCronExpression(
    config: Record<string, unknown>,
    path: string,
    issues: string[]
): void {
    const value = getNestedValue(config, path);
    if (typeof value !== "string" || !cron.validate(value)) {
        issues.push(`${path} must be a valid cron expression`);
    }
}

export function validateConfig(
    config: unknown,
    options: ConfigValidationOptions = {}
): asserts config is AppConfig {
    if (!isRecord(config)) {
        throw new ConfigValidationError([
            "Config must contain a YAML object at the top level",
        ]);
    }

    const mode = options.mode ?? "runnable";
    const missing: string[] = [];
    const issues: string[] = [];

    rejectUnknownKeys(config, "", [
        "instapaper",
        "filters",
        "translation",
        "tts",
        "spotify_upload",
        "schedule",
        "server",
        "feed",
        "feed_access",
        "admin",
        "data_dir",
    ], issues);
    rejectUnknownKeys(config, "instapaper", [
        "consumer_key",
        "consumer_secret",
        "username",
        "password",
    ], issues);
    rejectUnknownKeys(config, "filters", ["tags"], issues);
    rejectUnknownKeys(config, "translation", [
        "api_base",
        "api_key",
        "model",
        "target_language",
        "skip_if_same",
        "title_prompt",
        "text_prompt",
    ], issues);
    rejectUnknownKeys(config, "tts", ["voice", "rate", "pitch"], issues);
    rejectUnknownKeys(config, "spotify_upload", [
        "enabled",
        "cli_path",
        "show_id",
        "new_show",
        "show_title",
        "language",
        "summary",
        "image_path",
        "wait_for_ready",
    ], issues);
    rejectUnknownKeys(config, "schedule", ["cron"], issues);
    rejectUnknownKeys(config, "server", ["port", "base_url"], issues);
    rejectUnknownKeys(config, "feed", [
        "title",
        "description",
        "language",
        "author",
        "image",
    ], issues);
    rejectUnknownKeys(config, "feed_access", [
        "enabled",
        "token",
    ], issues);
    rejectUnknownKeys(config, "admin", [
        "password",
        "allowed_cidrs",
        "session_secret",
    ], issues);

    for (const field of RUNNABLE_REQUIRED_STRING_FIELDS) {
        if (mode === "runnable") {
            requireString(config, field, issues, missing);
        } else {
            optionalString(config, field, issues);
        }
    }

    requireStringArray(config, "filters.tags", issues);

    requireHttpUrl(config, "translation.api_base", issues);
    requireBoolean(config, "translation.skip_if_same", issues);
    requireString(config, "translation.model", issues, missing);
    requireString(config, "translation.target_language", issues, missing);
    optionalString(config, "translation.title_prompt", issues);
    optionalString(config, "translation.text_prompt", issues);

    requireString(config, "tts.voice", issues, missing);
    requireString(config, "tts.rate", issues, missing);
    requireString(config, "tts.pitch", issues, missing);

    const spotifyUpload = getNestedValue(config, "spotify_upload");
    if (spotifyUpload !== undefined) {
        if (!isRecord(spotifyUpload)) {
            issues.push("spotify_upload must be an object");
        } else {
            requireBoolean(config, "spotify_upload.enabled", issues);
            requireString(config, "spotify_upload.cli_path", issues, missing);
            requireString(config, "spotify_upload.language", issues, missing);
            requireBoolean(config, "spotify_upload.wait_for_ready", issues);
            optionalString(config, "spotify_upload.show_id", issues);
            optionalString(config, "spotify_upload.new_show", issues);
            optionalString(config, "spotify_upload.show_title", issues);
            optionalString(config, "spotify_upload.summary", issues);
            optionalString(config, "spotify_upload.image_path", issues);
        }
    }

    requireCronExpression(config, "schedule.cron", issues);
    requirePort(config, "server.port", issues);
    if (mode === "runnable") {
        requireHttpUrl(config, "server.base_url", issues);
    } else {
        optionalHttpUrl(config, "server.base_url", issues);
    }

    requireString(config, "feed.title", issues, missing);
    requireString(config, "feed.description", issues, missing);
    requireString(config, "feed.language", issues, missing);
    requireString(config, "feed.author", issues, missing);
    optionalHttpUrl(config, "feed.image", issues);

    const feedAccess = getNestedValue(config, "feed_access");
    if (feedAccess !== undefined) {
        if (!isRecord(feedAccess)) {
            issues.push("feed_access must be an object");
        } else {
            requireBoolean(config, "feed_access.enabled", issues);
            optionalString(config, "feed_access.token", issues);
            const enabled = getNestedValue(config, "feed_access.enabled") === true;
            const token = getNestedValue(config, "feed_access.token");
            if (enabled && isMissing(token)) {
                issues.push("feed_access.token is required when feed access protection is enabled");
            } else if (typeof token === "string" && token.length > 0 && !FEED_ACCESS_TOKEN_PATTERN.test(token)) {
                issues.push("feed_access.token must be 16-128 URL-safe characters (A-Z, a-z, 0-9, _ or -)");
            }
        }
    }

    const admin = getNestedValue(config, "admin");
    if (admin !== undefined) {
        if (!isRecord(admin)) {
            issues.push("admin must be an object");
        } else {
            optionalString(config, "admin.password", issues, { allowEmpty: false, minLength: 4 });
            optionalString(config, "admin.session_secret", issues, { allowEmpty: false, minLength: 16 });
            optionalStringArray(config, "admin.allowed_cidrs", issues);
        }
    }

    requireString(config, "data_dir", issues, missing);

    if (missing.length > 0) {
        issues.unshift(
            `Missing required config fields: ${missing.join(", ")}. ` +
            `Set them in config.yaml or via environment variables.`
        );
    }

    if (issues.length > 0) {
        throw new ConfigValidationError(issues);
    }
}

export function loadConfig(
    configPath?: string,
    options: ConfigValidationOptions = {}
): AppConfig {
    const filePath = configPath ?? process.env.CONFIG_PATH ?? "config.yaml";
    const resolved = resolve(filePath);

    let raw: Record<string, unknown> = {};

    try {
        const content = readFileSync(resolved, "utf-8");
        const parsed = yaml.load(content);
        if (parsed === undefined || parsed === null) {
            raw = {};
        } else if (isRecord(parsed)) {
            raw = parsed;
        } else {
            throw new Error(
                `Config file at ${resolved} must contain a YAML object at the top level.`
            );
        }
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            console.warn(`Config file not found at ${resolved}, using env + defaults`);
        } else {
            throw err;
        }
    }

    applyDefaults(raw);
    applyEnvOverrides(raw);
    validateConfig(raw, options);

    return raw;
}

/**
 * Save config back to the YAML file on disk.
 */
export function saveConfig(
    config: AppConfig,
    configPath?: string,
    options: ConfigValidationOptions = {}
): void {
    validateConfig(config, options);

    const filePath = configPath ?? process.env.CONFIG_PATH ?? "config.yaml";
    const resolved = resolve(filePath);
    const yamlStr = yaml.dump(config as unknown as Record<string, unknown>, {
        lineWidth: -1,
        quotingType: '"',
        forceQuotes: false,
    });
    writeFileSync(resolved, yamlStr, "utf-8");
}
