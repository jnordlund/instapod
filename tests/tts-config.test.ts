import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, validateConfig } from "../src/config.js";
import { DEFAULT_OPENAI_TTS, getTtsConfigIssues } from "../src/tts-config.js";
import { mergeConfigUpdate } from "../src/admin.js";
import { getOnboardingStatus } from "../src/onboarding.js";

const dirs: string[] = [];
afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function configFile(tts = "") {
    const dir = mkdtempSync(join(tmpdir(), "instapod-tts-config-"));
    dirs.push(dir);
    const path = join(dir, "config.yaml");
    writeFileSync(path, `instapaper:\n  consumer_key: ck\n  consumer_secret: cs\n  username: user\n  password: pass\ntranslation:\n  api_key: translation-key\nserver:\n  base_url: https://pod.example.com\n${tts}`);
    return path;
}

describe("TTS configuration", () => {
    it("keeps legacy Edge configs working and supplies separate OpenAI defaults", () => {
        const config = loadConfig(configFile('tts:\n  voice: custom-edge-voice\n  rate: "+10%"\n'));
        expect(config.tts.provider).toBe("edge-tts");
        expect(config.tts.voice).toBe("custom-edge-voice");
        expect(config.tts.rate).toBe("+10%");
        expect(config.tts.openai).toEqual(DEFAULT_OPENAI_TTS);
        expect(config.tts.openai?.api_key).toBe("");
    });
    it("applies and validates environment overrides and persists them in YAML", () => {
        const path = configFile();
        vi.stubEnv("TTS_PROVIDER", "openai");
        vi.stubEnv("TTS_OPENAI_API_MODE", "speech");
        vi.stubEnv("TTS_OPENAI_API_BASE", "http://localhost:8181/v1");
        vi.stubEnv("TTS_OPENAI_API_KEY", "");
        vi.stubEnv("TTS_OPENAI_MODEL", "local-tts");
        vi.stubEnv("TTS_OPENAI_VOICE", "local-voice");
        vi.stubEnv("TTS_OPENAI_SPEED", "1.25");
        vi.stubEnv("TTS_OPENAI_INSTRUCTIONS", "Calm narration");
        const config = loadConfig(path);
        expect(config.tts.openai).toMatchObject({ api_mode: "speech", model: "local-tts", voice: "local-voice", api_key: "", speed: 1.25, instructions: "Calm narration" });
        saveConfig(config, path);
        expect(readFileSync(path, "utf-8")).toContain("speed: 1.25");
        expect(loadConfig(path).tts).toEqual(config.tts);
        vi.stubEnv("TTS_OPENAI_SPEED", "fast");
        expect(() => loadConfig(path)).toThrow("tts.openai.speed");
    });
    it("permits draft OpenAI setup but blocks pipeline runs without an official API key", () => {
        const config = loadConfig(configFile("tts:\n  provider: openai\n"), { mode: "draft" });
        expect(() => validateConfig(config)).toThrow("tts.openai.api_key");
        const status = getOnboardingStatus(config, { episodeCount: 0, lastRun: null });
        expect(status.runnable).toBe(false);
        expect(status.steps.find((step) => step.id === "tts")?.status).toBe("missing");
        config.tts.provider = "edge-tts";
        expect(() => validateConfig(config)).not.toThrow();
    });
    it.each([
        "tts:\n  provider: other\n",
        "tts:\n  openai: null\n",
        "tts:\n  openai: []\n",
        "tts:\n  openai:\n    unexpected: true\n",
        "tts:\n  openai:\n    api_mode: unknown\n",
        "tts:\n  openai:\n    api_mode: realtime\n    speed: 1.51\n",
        "tts:\n  openai:\n    speed: 4.01\n",
        "tts:\n  openai:\n    api_key: 123\n",
        "tts:\n  openai:\n    api_base: file:///tmp/audio\n",
    ])("rejects malformed nested settings: %s", (yaml) => {
        expect(() => loadConfig(configFile(yaml), { mode: "draft" })).toThrow();
    });
    it("loads and persists Realtime through YAML and environment overrides without changing the Edge default", () => {
        const path = configFile();
        vi.stubEnv("TTS_OPENAI_API_MODE", "realtime");
        vi.stubEnv("TTS_OPENAI_MODEL", "gpt-realtime-2.1-mini");
        vi.stubEnv("TTS_OPENAI_SPEED", "1.5");
        const config = loadConfig(path);
        expect(config.tts.provider).toBe("edge-tts");
        expect(config.tts.openai).toMatchObject({ api_mode: "realtime", model: "gpt-realtime-2.1-mini", speed: 1.5 });
        saveConfig(config, path);
        expect(loadConfig(path).tts).toEqual(config.tts);
        config.tts.openai!.speed = 2;
        expect(getTtsConfigIssues(config.tts)).toContain("tts.openai.speed must be a number between 0.25 and 1.5");
    });
    it("preserves both providers and masked keys across saves, and permits clearing the local key", () => {
        const config = loadConfig(configFile());
        config.tts.openai = { ...DEFAULT_OPENAI_TTS, api_key: "tts-secret", voice: "coral", api_base: "http://localhost:8081/v1" };
        const merged = mergeConfigUpdate(config, { tts: { provider: "openai", openai: { api_key: "••••••••" } } });
        expect(merged.tts.openai?.api_key).toBe("tts-secret");
        expect(merged.translation.api_key).toBe("translation-key");
        expect(merged.tts.voice).toBe(config.tts.voice);
        const edge = mergeConfigUpdate(merged, { tts: { provider: "edge-tts" } });
        expect(edge.tts.openai?.voice).toBe("coral");
        const cleared = mergeConfigUpdate(edge, { tts: { openai: { api_key: "" } } });
        expect(cleared.tts.openai?.api_key).toBe("");
        expect(getTtsConfigIssues(cleared.tts)).toEqual([]);
        expect(config.tts.openai.api_key).toBe("tts-secret");
    });
});
