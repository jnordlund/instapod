import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import type { Server } from "node:http";
import { DEFAULT_OPENAI_TTS } from "../src/tts-config.js";
import { splitTextForTts } from "../src/tts-text.js";
import { synthesizeOpenAiChunk, synthesizeToFile } from "../src/tts-engine.js";
import { synthesize } from "../src/tts.js";
import { mp3AudioFrames, mp3Duration } from "../src/mp3.js";
import { TEST_MP3, TEST_MP3_WITH_METADATA } from "./tts-fixture.js";

const edge = vi.hoisted(() => ({ synthesize: vi.fn() }));
vi.mock("@andresaya/edge-tts", async () => {
    const fs = await import("node:fs/promises");
    const fixture = await import("./tts-fixture.js");
    return { EdgeTTS: class {
        synthesize(...args: unknown[]) { return edge.synthesize(...args); }
        async toFile(path: string) { await fs.writeFile(`${path}.mp3`, fixture.TEST_MP3); }
    } };
});

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    for (const server of servers.splice(0)) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function output() {
    const dir = await mkdtemp(join(tmpdir(), "instapod-tts-test-"));
    dirs.push(dir);
    return join(dir, "episode.mp3");
}

const baseTts = { voice: "sv-SE-SofieNeural", rate: "+0%", pitch: "+0Hz" };
function chatResponse(transcript: unknown, finishReason = "stop") {
    return { choices: [{ finish_reason: finishReason, message: { audio: { data: TEST_MP3.toString("base64"), transcript } } }] };
}

describe("narration text", () => {
    it.each([
        "A long sentence without a full stop ".repeat(350),
        "First sentence. " + "trailing text ".repeat(800),
        "\n\n" + "paragraph\n\n".repeat(1000),
        "😀".repeat(6000),
        "x".repeat(10000),
    ])("preserves all input and enforces a hard limit", (text) => {
        const chunks = splitTextForTts(text, 4000);
        expect(chunks.join("")).toBe(text);
        expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 4000)).toBe(true);
        expect(chunks.every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk))).toBe(true);
    });
});

describe("MP3 output", () => {
    it("removes per-file ID3/Xing metadata so joined chunks have the complete duration", () => {
        const frames = mp3AudioFrames(TEST_MP3_WITH_METADATA);
        expect(frames.includes(Buffer.from("ID3"))).toBe(false);
        expect(frames.includes(Buffer.from("Info"))).toBe(false);
        const joined = Buffer.concat([frames, frames, frames]);
        expect(mp3Duration(joined)).toBeCloseTo(mp3Duration(TEST_MP3_WITH_METADATA) * 3);
    });
    it("reads actual MPEG-2 MP3 duration and rejects HTML, empty, and truncated audio", () => {
        expect(mp3Duration(TEST_MP3)).toBeCloseTo(0.36, 1);
        for (const audio of [Buffer.alloc(0), Buffer.from("<html>upstream error</html>"), TEST_MP3.subarray(0, TEST_MP3.length - 20)]) {
            expect(() => mp3Duration(audio)).toThrow();
        }
    });
});

describe("TTS providers", () => {
    it("keeps Edge as the default and preserves its voice/rate/pitch", async () => {
        const path = await output();
        await synthesizeToFile("Hej världen", path, baseTts);
        expect(edge.synthesize).toHaveBeenCalledWith("Hej världen", baseTts.voice, { rate: "+0%", pitch: "+0Hz" });
        expect(await readFile(path)).toEqual(mp3AudioFrames(TEST_MP3));
    });

    it("uses Audio Chat MP3 with a dedicated key and narration instructions", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(chatResponse("Hej världen!"))));
        vi.stubGlobal("fetch", fetchMock);
        expect(await synthesizeOpenAiChunk("Hej världen!", { ...DEFAULT_OPENAI_TTS, api_key: "tts-key", instructions: "Speak calmly" })).toEqual(TEST_MP3);
        const [url, request] = fetchMock.mock.calls[0];
        expect(url).toBe("https://api.openai.com/v1/chat/completions");
        expect(request.headers.Authorization).toBe("Bearer tts-key");
        const body = JSON.parse(request.body);
        expect(body.audio).toEqual({ voice: "alloy", format: "mp3" });
        expect(body.modalities).toEqual(["text", "audio"]);
        expect(body.messages[0].content).toContain("natural spoken delivery");
        expect(body.messages[0].content).toContain("Do not summarize");
        expect(body.messages[0].content).toContain("Speak calmly");
        expect(body.messages[1].content).toBe("Hej världen!");
        expect(body).not.toHaveProperty("speed");
    });

    it("supports Speech API models/voices, speed, custom base paths, and no authentication", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(TEST_MP3));
        vi.stubGlobal("fetch", fetchMock);
        await synthesizeOpenAiChunk("Hello", { ...DEFAULT_OPENAI_TTS, api_mode: "speech", api_base: "http://localhost:1234/custom/v1///", model: "local-tts", voice: "local-voice", speed: 1.25 });
        const [url, request] = fetchMock.mock.calls[0];
        expect(url).toBe("http://localhost:1234/custom/v1/audio/speech");
        expect(request.headers).not.toHaveProperty("Authorization");
        expect(JSON.parse(request.body)).toEqual({ model: "local-tts", voice: "local-voice", input: "Hello", response_format: "mp3", speed: 1.25 });
    });

    it.each(["Beläggen. Onödigt krängel.", "", undefined, null])("accepts valid Audio Chat audio regardless of its transcript: %s", async (transcript) => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(chatResponse(transcript)))));
        expect(await synthesizeOpenAiChunk("Belägg. Onödigt krångel.", DEFAULT_OPENAI_TTS)).toEqual(TEST_MP3);
    });

    it("rejects incomplete generations, malformed JSON, and invalid audio", async () => {
        for (const response of [
            new Response(JSON.stringify(chatResponse("Hello", "length"))),
            new Response("invalid json"),
            new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { audio: { transcript: "Hello", data: "invalid base64!" } } }] })),
        ]) {
            vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
            await expect(synthesizeOpenAiChunk("Hello", DEFAULT_OPENAI_TTS)).rejects.toThrow();
        }
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>error</html>")));
        await expect(synthesizeOpenAiChunk("Hello", { ...DEFAULT_OPENAI_TTS, api_mode: "speech" })).rejects.toThrow("valid MP3");
    });

    it("reports actionable errors without echoing provider bodies, leaking keys, retrying, or falling back", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response("secret-key and article content", { status: 401 }));
        vi.stubGlobal("fetch", fetchMock);
        const path = await output();
        await expect(synthesizeToFile("Private article", path, { ...baseTts, provider: "openai", openai: { ...DEFAULT_OPENAI_TTS, api_key: "secret-key" } }))
            .rejects.toThrow("Check the TTS API key");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(edge.synthesize).not.toHaveBeenCalled();
    });

    it("cleans staging files when generation is cancelled", async () => {
        const path = await output();
        await expect(synthesize("Hello", path, {
            ...baseTts, provider: "openai",
            openai: { ...DEFAULT_OPENAI_TTS, api_base: "http://127.0.0.1:1/v1" },
        }, { signal: AbortSignal.abort() })).rejects.toThrow("cancelled");
        expect(await readdir(join(path, ".."))).toEqual([]);
    });

    it("processes long text sequentially through the actual worker and cleans temporary files on success and failure", async () => {
        const app = express();
        app.use(express.json());
        const inputs: string[] = [];
        let failing = false;
        app.post("/v1/chat/completions", (req, res) => {
            const text = req.body.messages[1].content;
            inputs.push(text);
            const result = chatResponse("The model chooses its own spoken delivery.");
            if (failing && inputs.length > 1) result.choices[0].message.audio.data = Buffer.from("invalid MP3").toString("base64");
            res.json(result);
        });
        const server = app.listen(0, "127.0.0.1");
        servers.push(server);
        await new Promise<void>((resolve) => server.once("listening", resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("No mock address");
        const config = { ...baseTts, provider: "openai" as const, openai: { ...DEFAULT_OPENAI_TTS, api_base: `http://127.0.0.1:${address.port}/v1` } };
        const text = "A sentence. ".repeat(800) + "THE TRAILING WORDS";
        const path = await output();
        const duration = await synthesize(text, path, config);
        expect(inputs.join("")).toBe(text);
        expect(inputs.every((input) => input.length <= 4000)).toBe(true);
        expect(duration).toBeGreaterThan(0);
        expect(await readdir(join(path, ".."))).toEqual(["episode.mp3"]);
        const previousAudio = await readFile(path);
        inputs.length = 0;
        failing = true;
        await expect(synthesize(text, path, config)).rejects.toThrow(/TTS audio-chat chunk 2\/3: .*valid MP3/);
        expect(await readdir(join(path, ".."))).toEqual(["episode.mp3"]);
        expect(await readFile(path)).toEqual(previousAudio);
    }, 15_000);
});
