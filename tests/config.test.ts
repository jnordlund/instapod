import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
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
    });

    it("throws on missing required fields", () => {
        const path = writeConfig(`
instapaper:
  consumer_key: "ck"
`);

        expect(() => loadConfig(path)).toThrow("Missing required config fields");
    });
});
