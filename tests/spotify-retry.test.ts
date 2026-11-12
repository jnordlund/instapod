import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { Duplex } from "node:stream";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { StateManager } from "../src/state.js";
import { SpotifyRetryManager } from "../src/spotify-retry.js";
import { checkSpotifyEpisodeStatus, uploadEpisodeToSpotify } from "../src/spotify.js";
import { enqueueWork, isWorkPending } from "../src/work-queue.js";
import { createAdminRouter } from "../src/admin.js";

vi.mock("../src/spotify.js", async importOriginal => ({
    ...await importOriginal<typeof import("../src/spotify.js")>(),
    uploadEpisodeToSpotify: vi.fn(),
    checkSpotifyEpisodeStatus: vi.fn(),
}));

const dirs: string[] = [];
afterEach(async () => {
    await enqueueWork(async () => {});
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.resetAllMocks();
});

// Exercise the real Express middleware and routes without requiring a listening port.
async function request(app: ReturnType<typeof express>, url: string, method = "GET", cookie = "", body = {}) {
    const req = new IncomingMessage(new Socket());
    req.url = url;
    req.method = method;
    req.headers = { host: "localhost", cookie };
    Object.assign(req, { body });
    const chunks: Buffer[] = [];
    const socket = new Duplex({
        read() {},
        write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
    });
    const res = new ServerResponse(req);
    res.assignSocket(socket);
    await new Promise<void>((resolve, reject) => {
        res.once("finish", resolve);
        res.once("error", reject);
        app(req, res);
    });
    const text = Buffer.concat(chunks).toString().split("\r\n\r\n").slice(1).join("\r\n\r\n");
    return { status: res.statusCode, headers: res.getHeaders(), text,
        body: String(res.getHeader("content-type")).includes("application/json") && text ? JSON.parse(text) : undefined };
}

function setup() {
    const dir = mkdtempSync(join(tmpdir(), "instapod-spotify-retry-"));
    dirs.push(dir);
    writeFileSync(join(dir, "config.yaml"), "{}");
    const config = loadConfig(join(dir, "config.yaml"), { mode: "draft" });
    config.data_dir = dir;
    config.spotify_upload = { enabled: true, cli_path: "save-to-spotify", language: "sv", wait_for_ready: false };
    config.admin = { password: "test-password", session_secret: "0123456789abcdef0123456789abcdef", allowed_cidrs: [] };
    mkdirSync(join(dir, "audio"));
    writeFileSync(join(dir, "audio", "123.mp3"), "existing audio");
    const state = new StateManager(dir);
    state.addProcessed({ bookmarkId: "123", filename: "123.mp3", title: "Saved title", source: "example.com", duration: 60, pubDate: "2026-01-01T00:00:00Z", spotify: { error: "Upload timed out" } });
    return { config, state, dir, retries: new SpotifyRetryManager(() => config, state) };
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

describe("Spotify retries", () => {
    it("requires explicit duplicate-risk confirmation before retrying an upload with no remote ID", () => {
        const { retries } = setup();
        expect(() => retries.request("123", false)).toThrow("could create a duplicate");
        expect(uploadEpisodeToSpotify).not.toHaveBeenCalled();
        expect(retries.getJob("123")).toBeUndefined();
    });

    it("reuses saved audio and metadata, preserving episode identity and the last pipeline run", async () => {
        const { retries, config, state, dir } = setup();
        const before = state.getProcessedBookmarks()[0];
        const lastRun = state.getLastRun();
        vi.mocked(uploadEpisodeToSpotify).mockResolvedValue({ episodeId: "remote", uploadedAt: "2026-11-12T10:00:00Z" });
        retries.request("123", true);
        await enqueueWork(async () => {});
        expect(uploadEpisodeToSpotify).toHaveBeenCalledWith(config, { filePath: join(dir, "audio", "123.mp3"), title: before.title, source: before.source });
        expect(state.getProcessedBookmarks()).toEqual([{ ...before, spotify: { episodeId: "remote", uploadedAt: "2026-11-12T10:00:00Z" } }]);
        expect(state.getLastRun()).toBe(lastRun);
        expect(retries.getJob("123")).toBeUndefined();
    });

    it.each(["episodeId", "episodeUri"] as const)("checks status for a known %s without uploading or requiring audio", async field => {
        const { retries, config, state, dir } = setup();
        const spotify = { [field]: "known-episode", uploadedAt: "2026-11-01T00:00:00Z", error: "Status timeout" };
        state.updateSpotify("123", spotify);
        unlinkSync(join(dir, "audio", "123.mp3"));
        vi.mocked(checkSpotifyEpisodeStatus).mockResolvedValue({ [field]: "known-episode", uploadedAt: spotify.uploadedAt, readyStatus: "ready" });
        retries.request("123", false);
        await enqueueWork(async () => {});
        expect(checkSpotifyEpisodeStatus).toHaveBeenCalledWith(config, spotify);
        expect(uploadEpisodeToSpotify).not.toHaveBeenCalled();
        expect(state.getProcessedBookmarks()[0].spotify?.error).toBeUndefined();
    });

    it("queues behind pipeline work, prevents repeated clicks, and reads current config and state after the pipeline completes", async () => {
        const { retries, config, state, dir } = setup();
        const gate = deferred();
        const pipeline = enqueueWork(async () => { await gate.promise; });
        try {
            retries.request("123", true);
            expect(retries.getJob("123")?.status).toBe("queued");
            expect(() => retries.request("123", true)).toThrow("already queued or running");
            expect(uploadEpisodeToSpotify).not.toHaveBeenCalled();
            config.spotify_upload!.show_id = "current-show";
            const childState = new StateManager(dir);
            childState.addProcessed({ bookmarkId: "456", filename: "456.mp3", title: "New pipeline episode", source: "", duration: 20, pubDate: "2026-11-12T00:00:00Z" });
            vi.mocked(uploadEpisodeToSpotify).mockResolvedValue({ episodeId: "remote" });
        } finally { gate.resolve(); }
        await pipeline;
        await enqueueWork(async () => {});
        expect(vi.mocked(uploadEpisodeToSpotify).mock.calls[0][0].spotify_upload?.show_id).toBe("current-show");
        expect(state.getProcessedBookmarks()).toHaveLength(2);
        expect(isWorkPending()).toBe(false);
    });

    it("revalidates configuration after waiting and saves failures for another attempt", async () => {
        const { retries, config, state } = setup();
        const gate = deferred();
        void enqueueWork(() => gate.promise);
        retries.request("123", true);
        config.spotify_upload!.enabled = false;
        gate.resolve();
        await enqueueWork(async () => {});
        expect(uploadEpisodeToSpotify).not.toHaveBeenCalled();
        expect(state.getProcessedBookmarks()[0].spotify?.error).toContain("Enable Spotify uploads");
        config.spotify_upload!.enabled = true;
        vi.mocked(uploadEpisodeToSpotify).mockRejectedValue(new Error("Authentication expired"));
        retries.request("123", true);
        await enqueueWork(async () => {});
        expect(state.getProcessedBookmarks()[0].spotify?.error).toBe("Authentication expired");
        expect(retries.getJob("123")).toBeUndefined();
    });

    it("rejects missing episodes/audio, disabled or missing CLI configuration, and successful episodes", () => {
        const { retries, config, state, dir } = setup();
        expect(() => retries.request("missing", true)).toThrow("Episode not found");
        config.spotify_upload!.enabled = false;
        expect(() => retries.request("123", true)).toThrow("Enable Spotify uploads");
        config.spotify_upload!.enabled = true;
        config.spotify_upload!.cli_path = join(dir, "missing-cli");
        expect(() => retries.request("123", true)).toThrow("Install the Spotify CLI");
        config.spotify_upload!.cli_path = "save-to-spotify";
        unlinkSync(join(dir, "audio", "123.mp3"));
        expect(() => retries.request("123", true)).toThrow("audio file is missing");
        state.updateSpotify("123", { episodeId: "uploaded" });
        expect(() => retries.request("123", true)).toThrow("Only failed Spotify attempts");
    });

    it("authenticates requests, returns background progress, and protects queued/running audio from deletion", async () => {
        const { config, state } = setup();
        const app = express();
        app.use(createAdminRouter(() => config, () => {}, state, async () => {}));
        const url = "/api/episodes/123/spotify/retry";
        expect((await request(app, url, "POST")).status).toBe(401);
        const login = await request(app, "/api/admin/login", "POST", "", { password: "test-password" });
        expect(login.status).toBe(200);
        const setCookie = login.headers["set-cookie"];
        const cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
        const page = await request(app, "/admin", "GET", cookie);
        expect(page.status).toBe(200);
        const scripts = [...page.text.matchAll(/<script>([\s\S]*?)<\/script>/g)];
        expect(scripts.length).toBeGreaterThan(0);
        for (const script of scripts) expect(() => new Function(script[1])).not.toThrow();
        expect((await request(app, url, "POST", cookie)).status).toBe(409);
        const gate = deferred();
        vi.mocked(uploadEpisodeToSpotify).mockImplementation(async () => { await gate.promise; return { episodeId: "remote" }; });
        try {
            const response = await request(app, url, "POST", cookie, { confirmDuplicateRisk: true });
            expect(response.status).toBe(202);
            const episodes = (await request(app, "/api/episodes", "GET", cookie)).body;
            expect(episodes[0].spotifyRetry).toEqual({ status: "running", mode: "upload" });
            expect((await request(app, url, "POST", cookie, { confirmDuplicateRisk: true })).status).toBe(409);
            expect((await request(app, "/api/episodes/123", "DELETE", cookie)).status).toBe(409);
        } finally { gate.resolve(); }
        await enqueueWork(async () => {});
        const episodes = (await request(app, "/api/episodes", "GET", cookie)).body;
        expect(episodes[0].spotifyRetry).toBeUndefined();
        expect(episodes[0].spotify).toEqual({ episodeId: "remote" });
    });
});
