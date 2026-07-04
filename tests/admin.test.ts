import { afterEach, describe, expect, it } from "vitest";
import { mergeConfigUpdate } from "../src/admin.js";
import { ConfigValidationError } from "../src/config.js";
import { createServer } from "../src/server.js";
import { StateManager } from "../src/state.js";
import type { AppConfig } from "../src/types.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";

let tempDirs: string[] = [];
let servers: Server[] = [];

afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => {
        server.close(() => resolve());
    })));
    servers = [];
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
});

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
        feed_access: {
            enabled: false,
            token: "",
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
            feed_access: {
                enabled: true,
                token: "abc1234567890_xyz",
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
        expect(merged.feed_access).toEqual({
            enabled: true,
            token: "abc1234567890_xyz",
        });
    });
});

describe("admin trigger", () => {
    it("serves the private landing page at the root", async () => {
        const dataDir = mkdtempSync(join(tmpdir(), "instapod-landing-test-"));
        tempDirs.push(dataDir);
        const config = makeConfig();
        config.data_dir = dataDir;

        const app = createServer(
            config,
            new StateManager(dataDir),
            async () => {}
        );
        const server = app.listen(0);
        servers.push(server);
        await new Promise<void>((resolve) => server.once("listening", resolve));
        const address = server.address();
        if (!address || typeof address === "string") {
            throw new Error("Expected TCP test server address");
        }
        const baseUrl = `http://127.0.0.1:${address.port}`;

        const response = await fetch(`${baseUrl}/`, { redirect: "manual" });
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(response.headers.get("location")).toBeNull();
        expect(body).toContain("Open admin");
        expect(body).toContain('href="/admin"');
        expect(body).toContain("https://github.com/jnordlund/instapod");
        expect(body).toContain('aria-label="GitHub repository"');

        const favicon = await fetch(`${baseUrl}/favicon.ico`);
        expect(favicon.status).toBe(204);
    });

    it("blocks manual pipeline runs until config is runnable", async () => {
        const dataDir = mkdtempSync(join(tmpdir(), "instapod-admin-test-"));
        tempDirs.push(dataDir);
        const config = makeConfig();
        config.data_dir = dataDir;
        config.instapaper.consumer_key = "";
        config.instapaper.consumer_secret = "";
        config.instapaper.password = "";
        config.translation.api_key = "";
        config.server.base_url = "";

        let triggered = false;
        const app = createServer(
            config,
            new StateManager(dataDir),
            async () => {
                triggered = true;
            }
        );
        const server = app.listen(0);
        servers.push(server);
        await new Promise<void>((resolve) => server.once("listening", resolve));
        const address = server.address();
        if (!address || typeof address === "string") {
            throw new Error("Expected TCP test server address");
        }
        const baseUrl = `http://127.0.0.1:${address.port}`;

        const login = await fetch(`${baseUrl}/api/admin/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: "secret" }),
        });
        expect(login.status).toBe(200);
        const cookie = login.headers.get("set-cookie")?.split(";")[0];
        expect(cookie).toBeTruthy();

        const maskedConfigResponse = await fetch(`${baseUrl}/api/config`, {
            headers: { Cookie: cookie ?? "" },
        });
        const maskedConfig = await maskedConfigResponse.json();
        expect(maskedConfig.instapaper.password).toBe("");
        expect(maskedConfig.translation.api_key).toBe("");
        expect(maskedConfig.admin.password).toBe("••••••••");
        expect(maskedConfig.feed_access).toEqual({
            enabled: false,
            token: "",
        });

        const trigger = await fetch(`${baseUrl}/api/trigger`, {
            method: "POST",
            headers: { Cookie: cookie ?? "" },
        });
        const body = await trigger.json();

        expect(trigger.status).toBe(409);
        expect(body.status).toBe("blocked");
        expect(body.onboarding.runnable).toBe(false);
        expect(triggered).toBe(false);
    });
});

describe("feed access routes", () => {
    async function startTestServer(config: AppConfig) {
        const dataDir = mkdtempSync(join(tmpdir(), "instapod-feed-access-test-"));
        tempDirs.push(dataDir);
        config.data_dir = dataDir;
        mkdirSync(join(dataDir, "audio"), { recursive: true });
        writeFileSync(join(dataDir, "audio", "test.mp3"), "audio");

        const app = createServer(
            config,
            new StateManager(dataDir),
            async () => {}
        );
        const server = app.listen(0);
        servers.push(server);
        await new Promise<void>((resolve) => server.once("listening", resolve));
        const address = server.address();
        if (!address || typeof address === "string") {
            throw new Error("Expected TCP test server address");
        }
        return `http://127.0.0.1:${address.port}`;
    }

    it("serves legacy feed and audio routes when token protection is disabled", async () => {
        const config = makeConfig();
        const baseUrl = await startTestServer(config);

        expect((await fetch(`${baseUrl}/feed`)).status).toBe(200);
        expect((await fetch(`${baseUrl}/abc1234567890_xyz/feed`)).status).toBe(404);
        expect((await fetch(`${baseUrl}/audio/test.mp3`)).status).toBe(200);
        expect((await fetch(`${baseUrl}/abc1234567890_xyz/audio/test.mp3`)).status).toBe(404);
    });

    it("requires the configured token for feed and audio routes when enabled", async () => {
        const config = makeConfig();
        config.feed_access = {
            enabled: true,
            token: "abc1234567890_xyz",
        };
        const baseUrl = await startTestServer(config);

        expect((await fetch(`${baseUrl}/feed`)).status).toBe(404);
        expect((await fetch(`${baseUrl}/wrongtoken123456/feed`)).status).toBe(404);
        expect((await fetch(`${baseUrl}/abc1234567890_xyz/feed`)).status).toBe(200);
        expect((await fetch(`${baseUrl}/audio/test.mp3`)).status).toBe(404);
        expect((await fetch(`${baseUrl}/wrongtoken123456/audio/test.mp3`)).status).toBe(404);
        expect((await fetch(`${baseUrl}/abc1234567890_xyz/audio/test.mp3`)).status).toBe(200);
    });
});
