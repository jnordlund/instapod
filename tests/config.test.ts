import { describe, it, expect } from "vitest";
import { loadConfig, validateConfig } from "../src/config.js";
import { join } from "node:path";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("loadConfig", () => {
    let tempDir: string;

    function writeConfig(content: string): string {
        tempDir = mkdtempSync(join(tmpdir(), "instapod-config-test-"));
        const path = join(tempDir, "config.yaml");
        writeFileSync(path, content, "utf-8");
        return path;
    }

    it("loads a valid config file", () => {
        const path = writeConfig(`
instapaper:
  consumer_key: "ck"
  consumer_secret: "cs"
  username: "user"
  password: "pass"
translation:
  api_key: "sk-test"
server:
  base_url: "https://pod.example.com"
`);

        const config = loadConfig(path);
        expect(config.instapaper.consumer_key).toBe("ck");
        expect(config.translation.api_key).toBe("sk-test");
        expect(config.server.base_url).toBe("https://pod.example.com");
    });

    it("applies default values", () => {
        const path = writeConfig(`
instapaper:
  consumer_key: "ck"
  consumer_secret: "cs"
  username: "user"
  password: "pass"
translation:
  api_key: "sk-test"
server:
  base_url: "https://pod.example.com"
`);

        const config = loadConfig(path);
        expect(config.tts.voice).toBe("sv-SE-SofieNeural");
        expect(config.server.port).toBe(8080);
        expect(config.schedule.cron).toBe("*/30 * * * *");
        expect(config.translation.model).toBe("gpt-4o-mini");
        expect(config.translation.title_prompt).toContain("{{target_language}}");
        expect(config.translation.text_prompt).toContain("{{target_language}}");
        expect(config.spotify_upload.enabled).toBe(false);
        expect(config.spotify_upload.cli_path).toBe("save-to-spotify");
        expect(config.spotify_upload.language).toBe("sv");
        expect(config.spotify_upload.wait_for_ready).toBe(false);
    });

    it("throws on missing required fields", () => {
        const path = writeConfig(`
instapaper:
  consumer_key: "ck"
`);

        expect(() => loadConfig(path)).toThrow("Missing required config fields");
    });

    it("treats an empty config file as env + defaults", () => {
        const path = writeConfig("");

        expect(() => loadConfig(path)).toThrow("Missing required config fields");
    });

    it("loads missing first-run config in draft mode", () => {
        const path = writeConfig("");

        const config = loadConfig(path, { mode: "draft" });
        expect(config.instapaper.consumer_key).toBe("");
        expect(config.translation.api_key).toBe("");
        expect(config.server.base_url).toBe("");
        expect(config.feed.title).toBe("Instapod");

        expect(() => validateConfig(config, { mode: "runnable" })).toThrow(
            "Missing required config fields"
        );
    });

    it("throws when the top-level YAML value is not an object", () => {
        const path = writeConfig(`
- not
- an
- object
`);

        expect(() => loadConfig(path)).toThrow("must contain a YAML object");
    });

    it("throws when typed config fields have invalid values", () => {
        const path = writeConfig(`
instapaper:
  consumer_key: "ck"
  consumer_secret: "cs"
  username: "user"
  password: "pass"
unexpected: true
filters:
  tags: "pod"
translation:
  api_base: "not-a-url"
  api_key: "sk-test"
  extra: "nope"
server:
  port: 70000
  base_url: "https://pod.example.com"
schedule:
  cron: "not a cron"
`);

        expect(() => loadConfig(path)).toThrow("unexpected is not a supported config key");
        expect(() => loadConfig(path)).toThrow("translation.extra is not a supported config key");
        expect(() => loadConfig(path)).toThrow("filters.tags must be an array of strings");
        expect(() => loadConfig(path)).toThrow("translation.api_base must be an http(s) URL");
        expect(() => loadConfig(path)).toThrow("server.port must be an integer between 1 and 65535");
        expect(() => loadConfig(path)).toThrow("schedule.cron must be a valid cron expression");
    });
});
