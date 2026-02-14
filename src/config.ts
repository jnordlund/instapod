import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { AppConfig } from "./types.js";

const REQUIRED_FIELDS = [
    "instapaper.consumer_key",
    "instapaper.consumer_secret",
    "instapaper.username",
    "instapaper.password",
    "translation.api_key",
    "server.base_url",
] as const;

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split(".").reduce<unknown>((acc, key) => {
        if (acc && typeof acc === "object") {
            return (acc as Record<string, unknown>)[key];
        }
        return undefined;
    }, obj);
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
        // Convert port to number
        if (configPath === "server.port") {
            target[lastKey] = parseInt(envValue, 10);
        } else {
            target[lastKey] = envValue;
        }
    }
}

const DEFAULTS: Partial<Record<string, unknown>> = {
    "filters.tags": [],
    "translation.api_base": "https://api.openai.com/v1",
    "translation.model": "gpt-4o-mini",
    "translation.target_language": "svenska",
    "translation.skip_if_same": true,
    "tts.voice": "sv-SE-SofieNeural",
    "tts.rate": "+0%",
    "tts.pitch": "+0Hz",
    "schedule.cron": "*/30 * * * *",
    "server.port": 8080,
    "feed.title": "Instapod",
    "feed.description": "Artiklar upplästa som podcast",
    "feed.language": "sv",
    "feed.author": "Instapod",
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

function validate(config: Record<string, unknown>): void {
    const missing: string[] = [];
    for (const field of REQUIRED_FIELDS) {
        const value = getNestedValue(config, field);
        if (value === undefined || value === null || value === "") {
            missing.push(field);
        }
    }
    if (missing.length > 0) {
        throw new Error(
            `Missing required config fields: ${missing.join(", ")}. ` +
            `Set them in config.yaml or via environment variables.`
        );
    }
}

export function loadConfig(configPath?: string): AppConfig {
    const filePath = configPath ?? process.env.CONFIG_PATH ?? "config.yaml";
    const resolved = resolve(filePath);

    let raw: Record<string, unknown> = {};

    try {
        const content = readFileSync(resolved, "utf-8");
        raw = yaml.load(content) as Record<string, unknown>;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            console.warn(`Config file not found at ${resolved}, using env + defaults`);
        } else {
            throw err;
        }
    }

    applyDefaults(raw);
    applyEnvOverrides(raw);
    validate(raw);

    return raw as unknown as AppConfig;
}

/**
 * Save config back to the YAML file on disk.
 */
export function saveConfig(config: AppConfig, configPath?: string): void {
    const filePath = configPath ?? process.env.CONFIG_PATH ?? "config.yaml";
    const resolved = resolve(filePath);
    const yamlStr = yaml.dump(config as unknown as Record<string, unknown>, {
        lineWidth: -1,
        quotingType: '"',
        forceQuotes: false,
    });
    writeFileSync(resolved, yamlStr, "utf-8");
}
