import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { DEFAULT_OPENAI_TTS } from "../src/tts-config.js";
import { requestRealtimeAudio } from "../src/tts-realtime.js";
import { synthesize } from "../src/tts.js";
import { synthesizeToFile } from "../src/tts-engine.js";
import { mp3Duration } from "../src/mp3.js";
import { ensureFfmpegAvailable } from "../src/tts-ffmpeg.js";

// Synthetic 440 Hz tone, not speech or a paid API recording.
const PCM = Buffer.alloc(24000);
for (let i = 0; i < PCM.length / 2; i++) PCM.writeInt16LE(Math.round(4000 * Math.sin(i * 2 * Math.PI * 440 / 24000)), i * 2);
const baseTts = { voice: "sv-SE-SofieNeural", rate: "+0%", pitch: "+0Hz" };
const servers: Array<{ http: Server; ws: WebSocketServer }> = [];
const dirs: string[] = [];
afterEach(async () => {
    vi.unstubAllEnvs();
    for (const { http, ws } of servers.splice(0)) {
        for (const client of ws.clients) client.terminate();
        await new Promise<void>((resolve) => ws.close(() => resolve()));
        http.closeAllConnections();
        await new Promise<void>((resolve) => http.close(() => resolve()));
    }
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
async function output() {
    const dir = await mkdtemp(join(tmpdir(), "instapod-realtime-test-"));
    dirs.push(dir);
    return join(dir, "episode.mp3");
}

function send(ws: WebSocket, event: unknown) { ws.send(JSON.stringify(event)); }
function startResponse(ws: WebSocket) { send(ws, { type: "response.created", response: { id: "resp1" } }); }
function delta(ws: WebSocket, bytes = PCM) {
    send(ws, { type: "response.output_audio.delta", response_id: "resp1", item_id: "item1", content_index: 0, delta: bytes.toString("base64") });
}
function done(ws: WebSocket, text: unknown, status = "completed") {
    send(ws, { type: "response.done", response: {
        id: "resp1", status, output: [{ id: "item1", type: "message", role: "assistant", content: [{ type: "output_audio", transcript: text }] }],
    } });
}
async function provider(
    respond: (ws: WebSocket, event: any, req: IncomingMessage) => void = (ws, event) => {
        startResponse(ws); delta(ws); done(ws, event.response.input[0].content[0].text);
    },
    options: { status?: number; format?: unknown } = {},
) {
    const http = createServer((_req, res) => res.writeHead(404).end());
    const ws = new WebSocketServer({ noServer: true });
    servers.push({ http, ws });
    const requests: IncomingMessage[] = [];
    const sessions: any[] = [];
    const responses: any[] = [];
    http.on("upgrade", (req, socket, head) => {
        requests.push(req);
        if (options.status) { socket.end(`HTTP/1.1 ${options.status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return; }
        ws.handleUpgrade(req, socket, head, client => ws.emit("connection", client, req));
    });
    ws.on("connection", (client, req) => {
        client.on("message", raw => {
            const event = JSON.parse(raw.toString());
            if (event.type === "session.update") {
                sessions.push(event.session);
                send(client, { type: "session.updated", session: { audio: { output: { format: options.format ?? event.session.audio.output.format } } } });
            } else if (event.type === "response.create") {
                responses.push(event.response);
                respond(client, event, req);
            }
        });
        send(client, { type: "session.created" });
    });
    await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    const config = { ...DEFAULT_OPENAI_TTS, api_mode: "realtime" as const, api_base: `http://127.0.0.1:${address.port}/custom/v1///`, model: "gpt-realtime-2.1-mini", voice: "cedar", speed: 1.25, instructions: "Read calmly" };
    return { config, requests, sessions, responses, ws };
}

describe("Realtime narration", () => {
    it("uses the GA session contract, selected model/key/voice/speed, and complete text without conversation history", async () => {
        const mock = await provider((ws, event) => {
            startResponse(ws);
            delta(ws, PCM.subarray(0, 8000));
            delta(ws, PCM.subarray(8000));
            done(ws, event.response.input[0].content[0].text);
        });
        const text = "Hej, världen! Read all these words.";
        expect(await requestRealtimeAudio(text, { ...mock.config, api_key: "test-tts-secret" })).toEqual(PCM);
        expect(mock.requests[0].url).toBe("/custom/v1/realtime?model=gpt-realtime-2.1-mini");
        expect(mock.requests[0].headers.authorization).toBe("Bearer test-tts-secret");
        expect(mock.sessions[0]).toMatchObject({ type: "realtime", output_modalities: ["audio"], tools: [], audio: {
            input: { turn_detection: null }, output: { format: { type: "audio/pcm", rate: 24000 }, voice: "cedar", speed: 1.25 },
        } });
        expect(mock.sessions[0].instructions).toContain("verbatim");
        expect(mock.sessions[0].instructions).toContain("Read calmly");
        expect(mock.responses[0]).toEqual({ conversation: "none", output_modalities: ["audio"], input: [{ type: "message", role: "user", content: [{ type: "input_text", text }] }] });
    });

    it("rejects a service that does not accept PCM before submitting article text", async () => {
        const mock = await provider(undefined, { format: { type: "audio/pcmu" } });
        await expect(requestRealtimeAudio("Private article", mock.config)).rejects.toThrow("24 kHz PCM");
        expect(mock.responses).toHaveLength(0);
    });

    it.each(["changed text", undefined, ""])(("rejects a changed or missing transcript: %s"), async transcript => {
        const mock = await provider(ws => { startResponse(ws); delta(ws); done(ws, transcript); });
        await expect(requestRealtimeAudio("Original text", mock.config)).rejects.toThrow(/transcript/);
    });

    it.each(["incomplete", "failed", "cancelled"])("rejects %s responses even when audio and transcript were delivered", async status => {
        const mock = await provider(ws => { startResponse(ws); delta(ws); done(ws, "Original text", status); });
        await expect(requestRealtimeAudio("Original text", mock.config)).rejects.toThrow("did not finish");
    });

    it.each(["no-audio", "odd-pcm", "bad-base64", "bad-json", "wrong-response", "early-close"])("rejects corrupt or unfinished streams: %s", async failure => {
        const mock = await provider(ws => {
            startResponse(ws);
            if (failure === "early-close") { ws.close(); return; }
            if (failure === "bad-json") { ws.send("{broken"); return; }
            if (failure === "bad-base64" || failure === "wrong-response") {
                send(ws, { type: "response.output_audio.delta", response_id: failure === "wrong-response" ? "other" : "resp1", item_id: "item1", content_index: 0, delta: "invalid!" });
            } else if (failure !== "no-audio") delta(ws, PCM.subarray(0, 3));
            done(ws, "Original text");
        });
        await expect(requestRealtimeAudio("Original text", mock.config)).rejects.toThrow(/Realtime TTS/);
    });

    it.each([401, 403, 429])("reports HTTP %s handshake failures without exposing upstream text or retrying", async status => {
        const mock = await provider(undefined, { status });
        await expect(requestRealtimeAudio("Private article", { ...mock.config, api_key: "secret-key" })).rejects.toThrow(`(${status})`);
        expect(mock.requests).toHaveLength(1);
    });

    it("sanitizes upstream error events and reports quota errors", async () => {
        const mock = await provider(ws => send(ws, { type: "error", error: { code: "insufficient_quota", message: "secret-key Private article" } }));
        const error = await requestRealtimeAudio("Private article", mock.config).catch(err => err);
        expect(error.message).toContain("quota");
        expect(error.message).not.toMatch(/secret-key|Private article/);
    });

    it("times out and closes a stalled session", async () => {
        const mock = await provider(() => {});
        await expect(requestRealtimeAudio("Hello", mock.config, { timeoutMs: 50 })).rejects.toThrow("timed out");
    });

    it("cancels an active session", async () => {
        const controller = new AbortController();
        const mock = await provider(() => controller.abort());
        await expect(requestRealtimeAudio("Hello", mock.config, { signal: controller.signal })).rejects.toThrow("cancelled");
    });

    it("encodes and joins long narration through the actual worker, keeping all source text and omitting empty local auth", async () => {
        const mock = await provider();
        const path = await output();
        const text = "En längre artikel utan punkt med alla ord kvar ".repeat(80);
        const duration = await synthesize(text, path, { ...baseTts, provider: "openai", openai: mock.config });
        expect(mock.responses.length).toBeGreaterThan(1);
        expect(mock.responses.map(response => response.input[0].content[0].text).join("")).toBe(text);
        expect(mock.responses.every(response => response.input[0].content[0].text.length <= 1500)).toBe(true);
        expect(mock.requests.every(req => req.headers.authorization === undefined)).toBe(true);
        expect(duration).toBeGreaterThanOrEqual(1);
        expect(mp3Duration(await readFile(path))).toBeCloseTo(mock.responses.length * 0.552, 1);
        expect(await readdir(join(path, ".."))).toEqual(["episode.mp3"]);
    }, 15_000);

    it("preserves existing output and cleans staging files if a later chunk fails", async () => {
        let calls = 0;
        const mock = await provider((ws, event) => { startResponse(ws); delta(ws); done(ws, ++calls === 1 ? event.response.input[0].content[0].text : "changed text"); });
        const path = await output();
        await writeFile(path, "old episode");
        await expect(synthesize("word ".repeat(400), path, { ...baseTts, provider: "openai", openai: mock.config })).rejects.toThrow("differs");
        expect(calls).toBe(2);
        expect(await readFile(path, "utf8")).toBe("old episode");
        expect(await readdir(join(path, ".."))).toEqual(["episode.mp3"]);
    }, 15_000);

    it("cleans the real worker and socket when the caller cancels generation", async () => {
        const controller = new AbortController();
        const mock = await provider(() => setTimeout(() => controller.abort(), 50));
        const path = await output();
        await expect(synthesize("Hello", path, { ...baseTts, provider: "openai", openai: mock.config }, { signal: controller.signal })).rejects.toThrow("cancelled");
        expect(await readdir(join(path, ".."))).toEqual([]);
        expect(mock.requests).toHaveLength(1);
    }, 15_000);

    it("reports missing FFmpeg before opening a paid session", async () => {
        const mock = await provider();
        const path = await output();
        vi.stubEnv("PATH", join(path, "missing-bin"));
        await expect(synthesizeToFile("Hello", path, { ...baseTts, provider: "openai", openai: mock.config })).rejects.toThrow("requires FFmpeg");
        expect(mock.requests).toHaveLength(0);
    });

    it("supports cancellation during encoder startup", async () => {
        await expect(ensureFfmpegAvailable(AbortSignal.abort())).rejects.toThrow("cancelled");
    });
});
