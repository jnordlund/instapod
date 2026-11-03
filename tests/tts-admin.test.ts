import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { createAdminRouter } from "../src/admin.js";
import { StateManager } from "../src/state.js";
import { DEFAULT_OPENAI_TTS } from "../src/tts-config.js";
import { TEST_MP3 } from "./tts-fixture.js";
import { mp3AudioFrames } from "../src/mp3.js";

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
    for (const server of servers.splice(0)) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function listen(app: ReturnType<typeof express>) {
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test address");
    return `http://127.0.0.1:${address.port}`;
}

async function setup() {
    const dir = mkdtempSync(join(tmpdir(), "instapod-preview-test-"));
    dirs.push(dir);
    const path = join(dir, "config.yaml");
    writeFileSync(path, "{}");
    const config = loadConfig(path, { mode: "draft" });
    config.data_dir = dir;
    config.admin = { password: "test-password", session_secret: "0123456789abcdef0123456789abcdef", allowed_cidrs: [] };
    config.tts.openai = { ...DEFAULT_OPENAI_TTS, api_key: "stored-tts-key" };
    const state = new StateManager(dir);
    let changed = false;
    const app = express();
    app.use(express.json());
    app.use(createAdminRouter(() => config, () => { changed = true; }, state, async () => { throw new Error("Preview must not trigger the pipeline"); }));
    const base = await listen(app);
    const response = await fetch(`${base}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "test-password" }) });
    const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).not.toBe("");
    return { base, cookie, config, dir, path, state, changed: () => changed };
}

describe("voice preview admin API", () => {
    it("requires authentication for model discovery", async () => {
        const { base } = await setup();
        const response = await fetch(`${base}/api/tts/models`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        expect(response.status).toBe(401);
    });

    it("discovers models with an unsaved endpoint and masked key before a model or voice is selected", async () => {
        const admin = await setup();
        const provider = express();
        let authorization: string | undefined;
        provider.get("/custom/models", (req, res) => {
            authorization = req.get("authorization");
            res.json({ data: [{ id: "local-voice-model" }, { id: "gpt-audio-1.5" }] });
        });
        const base = await listen(provider);
        const before = readFileSync(admin.path, "utf-8");
        const response = await fetch(`${admin.base}/api/tts/models`, {
            method: "POST", headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ tts: { openai: { api_base: `${base}/custom`, api_key: "••••••••", model: "", voice: "" } } }),
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({ models: ["gpt-audio-1.5", "local-voice-model"] });
        expect(authorization).toBe("Bearer stored-tts-key");
        expect(admin.config.tts.openai?.model).toBe("gpt-audio-1.5");
        expect(admin.changed()).toBe(false);
        expect(readFileSync(admin.path, "utf-8")).toBe(before);
        expect(admin.state.getProcessedBookmarks()).toEqual([]);
    });

    it("requires authentication and masks the dedicated TTS key", async () => {
        const { base, cookie } = await setup();
        const denied = await fetch(`${base}/api/tts/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Hello" }) });
        expect(denied.status).toBe(401);
        const response = await fetch(`${base}/api/config`, { headers: { Cookie: cookie } });
        const body = await response.json();
        expect(body.tts.openai.api_key).toBe("••••••••");
        expect(JSON.stringify(body)).not.toContain("stored-tts-key");
    });

    it("previews unsaved configuration with a masked saved key without saving or publishing", async () => {
        const admin = await setup();
        const calls: Array<{ path: string; authorization?: string; body: any }> = [];
        const provider = express();
        provider.use(express.json());
        provider.post("/v1/chat/completions", (req, res) => {
            calls.push({ path: req.path, authorization: req.get("authorization"), body: req.body });
            res.json({ choices: [{ finish_reason: "stop", message: { audio: { data: TEST_MP3.toString("base64"), transcript: "The voice provider chooses a natural rendition." } } }] });
        });
        const providerBase = await listen(provider);
        const before = readFileSync(admin.path, "utf-8");
        const filesBefore = readdirSync(admin.dir).sort();
        const response = await fetch(`${admin.base}/api/tts/preview`, {
            method: "POST", headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ text: "Unsaved voice preview", tts: { provider: "openai", openai: { api_base: `${providerBase}/v1`, api_key: "••••••••", voice: "custom-voice" } } }),
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("content-type")).toContain("audio/mpeg");
        expect(Buffer.from(await response.arrayBuffer())).toEqual(mp3AudioFrames(TEST_MP3));
        expect(calls).toHaveLength(1);
        expect(calls[0].authorization).toBe("Bearer stored-tts-key");
        expect(calls[0].body.audio.voice).toBe("custom-voice");
        expect(admin.config.tts.provider).toBe("edge-tts");
        expect(admin.changed()).toBe(false);
        expect(readFileSync(admin.path, "utf-8")).toBe(before);
        expect(readdirSync(admin.dir).sort()).toEqual(filesBefore);
        expect(admin.state.getProcessedBookmarks()).toEqual([]);
    }, 15_000);

    it("supports keyless Speech API previews and bounds sample length", async () => {
        const admin = await setup();
        const provider = express();
        provider.use(express.json());
        provider.post("/custom/audio/speech", (req, res) => {
            expect(req.get("authorization")).toBeUndefined();
            expect(req.body.speed).toBe(1.2);
            res.type("audio/mpeg").send(TEST_MP3);
        });
        const providerBase = await listen(provider);
        const post = (text: string) => fetch(`${admin.base}/api/tts/preview`, {
            method: "POST", headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ text, tts: { provider: "openai", openai: { api_base: `${providerBase}/custom`, api_mode: "speech", api_key: "", model: "local-tts", speed: 1.2 } } }),
        });
        const preview = await post("Hello");
        expect(preview.status).toBe(200);
        expect(Buffer.from(await preview.arrayBuffer())).toEqual(mp3AudioFrames(TEST_MP3));
        for (const text of ["", " ", "x".repeat(501)]) {
            expect((await post(text)).status).toBe(400);
        }
    }, 15_000);
});
