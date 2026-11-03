import type { OpenAiTtsConfig, TtsConfig } from "./types.js";

export const DEFAULT_OPENAI_TTS: Readonly<OpenAiTtsConfig> = {
    api_mode: "audio-chat",
    api_base: "https://api.openai.com/v1",
    api_key: "",
    model: "gpt-audio-1.5",
    voice: "alloy",
    instructions: "",
    speed: 1,
};

export function resolveTtsConfig(config: TtsConfig) {
    return {
        ...config,
        provider: config.provider ?? "edge-tts",
        openai: { ...DEFAULT_OPENAI_TTS, ...config.openai },
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function getTtsConfigIssues(value: unknown, runnable = true): string[] {
    if (!isRecord(value)) return ["tts must be an object"];
    const issues: string[] = [];
    const provider = value.provider === undefined ? "edge-tts" : value.provider;
    if (provider !== "edge-tts" && provider !== "openai") {
        issues.push("tts.provider must be edge-tts or openai");
    }
    for (const key of ["voice", "rate", "pitch"]) {
        if (typeof value[key] !== "string" || !(value[key] as string).trim()) {
            issues.push(`tts.${key} must be a non-empty string`);
        }
    }
    if (value.openai !== undefined && !isRecord(value.openai)) {
        return [...issues, "tts.openai must be an object"];
    }
    const settings = { ...DEFAULT_OPENAI_TTS, ...(value.openai ?? {}) } as Record<string, unknown>;
    if (!["audio-chat", "speech", "realtime"].includes(settings.api_mode as string)) {
        issues.push("tts.openai.api_mode must be audio-chat, speech, or realtime");
    }
    for (const key of ["api_base", "api_key", "model", "voice", "instructions"]) {
        if (typeof settings[key] !== "string") {
            issues.push(`tts.openai.${key} must be a string`);
        }
    }
    let url: URL | undefined;
    if (typeof settings.api_base === "string" && settings.api_base.trim()) {
        try {
            url = new URL(settings.api_base);
            if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
                throw new Error();
            }
        } catch {
            issues.push("tts.openai.api_base must be an http(s) base URL without credentials, query, or fragment");
        }
    } else if (runnable && provider === "openai") {
        issues.push("tts.openai.api_base is required for OpenAI TTS");
    }
    const maxSpeed = settings.api_mode === "realtime" ? 1.5 : 4;
    if (typeof settings.speed !== "number" || !Number.isFinite(settings.speed) || settings.speed < 0.25 || settings.speed > maxSpeed) {
        issues.push(`tts.openai.speed must be a number between 0.25 and ${maxSpeed}`);
    }
    if (typeof settings.instructions === "string" && settings.instructions.length > 4096) {
        issues.push("tts.openai.instructions must be at most 4096 characters");
    }
    if (runnable && provider === "openai") {
        for (const key of ["model", "voice"]) {
            if (typeof settings[key] === "string" && !(settings[key] as string).trim()) {
                issues.push(`tts.openai.${key} is required for OpenAI TTS`);
            }
        }
        if (url?.hostname === "api.openai.com" && (typeof settings.api_key !== "string" || !settings.api_key.trim())) {
            issues.push("tts.openai.api_key is required for api.openai.com; local compatible services may use an empty key");
        }
    }
    return issues;
}
