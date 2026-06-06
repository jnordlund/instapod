import { describe, expect, it } from "vitest";
import { mergeConfigUpdate } from "../src/admin.js";
import { ConfigValidationError } from "../src/config.js";
import type { AppConfig } from "../src/types.js";

function makeConfig(): AppConfig {
    return {
        instapaper: {
            consumer_key: "ck",
            consumer_secret: "cs",
            username: "user",
            password: "pass",
        },
        filters: { tags: ["pod"] },
        translation: {
            api_base: "https://api.openai.com/v1",
            api_key: "sk-test",
            model: "gpt-4o-mini",
            target_language: "svenska",
            skip_if_same: true,
            title_prompt: "",
            text_prompt: "",
        },
        tts: {
            voice: "sv-SE-SofieNeural",
            rate: "+0%",
            pitch: "+0Hz",
        },
        spotify_upload: {
            enabled: false,
            cli_path: "save-to-spotify",
            language: "sv",
            wait_for_ready: false,
        },
        schedule: { cron: "*/30 * * * *" },
        server: {
            port: 8080,
            base_url: "https://pod.example.com",
        },
        feed: {
            title: "Test Feed",
            description: "A test feed",
            language: "sv",
            author: "Tester",
        },
        admin: {
            password: "secret",
            session_secret: "0123456789abcdef0123456789abcdef",
            allowed_cidrs: [],
        },
        data_dir: "/tmp/instapod-test",
    };
}

describe("mergeConfigUpdate", () => {
    it("rejects invalid admin-save updates", () => {
        const current = makeConfig();

        expect(() => mergeConfigUpdate(current, null)).toThrow(ConfigValidationError);

        expect(() =>
            mergeConfigUpdate(current, {
                server: { port: 70000 } as AppConfig["server"],
                unsupported: true,
            })
        ).toThrow(ConfigValidationError);

        try {
            mergeConfigUpdate(current, {
                server: { port: 70000 } as AppConfig["server"],
                unsupported: true,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(ConfigValidationError);
            expect((err as ConfigValidationError).issues).toContain(
                "unsupported is not a supported config key"
            );
            expect((err as ConfigValidationError).issues).toContain(
                "server.port must be an integer between 1 and 65535"
            );
        }

        expect(current.server.port).toBe(8080);
    });

    it("preserves masked secrets while accepting valid updates", () => {
        const current = makeConfig();

        const merged = mergeConfigUpdate(current, {
            instapaper: {
                ...current.instapaper,
                consumer_secret: "••••••••",
                password: "••••••••",
            },
            translation: {
                ...current.translation,
                api_key: "••••••••",
            },
            admin: {
                password: "••••••••",
                allowed_cidrs: ["127.0.0.0/8"],
            },
            server: {
                port: 9090,
                base_url: "https://new.example.com",
            },
        });

        expect(merged.instapaper.consumer_secret).toBe("cs");
        expect(merged.instapaper.password).toBe("pass");
        expect(merged.translation.api_key).toBe("sk-test");
        expect(merged.admin?.password).toBe("secret");
        expect(merged.admin?.session_secret).toBe("0123456789abcdef0123456789abcdef");
        expect(merged.admin?.allowed_cidrs).toEqual(["127.0.0.0/8"]);
        expect(merged.server).toEqual({
            port: 9090,
            base_url: "https://new.example.com",
        });
    });
});
