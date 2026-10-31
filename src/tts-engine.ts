import { EdgeTTS } from "@andresaya/edge-tts";
import { appendFile, readFile, unlink, writeFile } from "node:fs/promises";
import type { OpenAiTtsConfig, TtsConfig } from "./types.js";
import { getTtsConfigIssues, resolveTtsConfig } from "./tts-config.js";
import { assertNarrationTranscript, narrationInstructions, splitTextForTts } from "./tts-text.js";
import { mp3AudioFrames, mp3Duration } from "./mp3.js";
import { requestRealtimeAudio } from "./tts-realtime.js";
import { encodeRealtimeMp3, ensureFfmpegAvailable } from "./tts-ffmpeg.js";

function apiError(status: number): Error {
    const hint = status === 401 ? "Check the TTS API key."
        : status === 403 ? "Check model access and API key permissions."
        : status === 429 ? "Check API quota and rate limits, then retry."
        : status >= 500 ? "The TTS service is unavailable; retry later."
        : "Check the API mode, base URL, model, voice, and supported settings.";
    return new Error(`TTS API error (${status}). ${hint}`);
}

export async function synthesizeOpenAiChunk(text: string, config: OpenAiTtsConfig, signal?: AbortSignal): Promise<Buffer> {
    if (config.api_mode === "realtime") {
        const audio = await encodeRealtimeMp3(await requestRealtimeAudio(text, config, { signal }), signal);
        mp3Duration(audio);
        return audio;
    }
    const speech = config.api_mode === "speech";
    const url = `${config.api_base.replace(/\/+$/, "")}/${speech ? "audio/speech" : "chat/completions"}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.api_key.trim()) headers.Authorization = `Bearer ${config.api_key}`;
    const body = speech ? {
        model: config.model, voice: config.voice, input: text,
        response_format: "mp3", speed: config.speed,
        ...(config.instructions.trim() ? { instructions: config.instructions } : {}),
    } : {
        model: config.model,
        modalities: ["text", "audio"],
        audio: { voice: config.voice, format: "mp3" },
        messages: [
            {
                role: "system",
                content: narrationInstructions(config.instructions),
            },
            { role: "user", content: text },
        ],
    };
    let response: Response;
    try {
        response = await fetch(url, {
            method: "POST", headers, body: JSON.stringify(body), redirect: "error",
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
        });
    } catch (err) {
        const timeout = err instanceof Error && ["TimeoutError", "AbortError"].includes(err.name);
        throw new Error(timeout
            ? "TTS API timed out. Retry or use shorter text."
            : "Could not reach the TTS API. Check its base URL and network connection.");
    }
    if (!response.ok) {
        await response.body?.cancel();
        throw apiError(response.status);
    }
    let audio: Buffer;
    try {
        if (speech) {
            audio = Buffer.from(await response.arrayBuffer());
        } else {
            const result = await response.json() as {
                choices?: Array<{ finish_reason?: string; message?: { audio?: { data?: unknown; transcript?: unknown } } }>;
            };
            const choice = result?.choices?.[0];
            if (choice?.finish_reason !== "stop") {
                throw new Error("Audio API did not finish the narration; no episode was produced. Try a shorter article or another model.");
            }
            const output = choice.message?.audio;
            assertNarrationTranscript(text, output?.transcript);
            if (typeof output?.data !== "string" || !output.data || !/^[A-Za-z0-9+/]+={0,2}$/.test(output.data)) {
                throw new Error("Audio API returned no valid base64 audio");
            }
            audio = Buffer.from(output.data, "base64");
        }
    } catch (err) {
        if (err instanceof SyntaxError) throw new Error("TTS API returned invalid audio JSON");
        throw err;
    }
    mp3Duration(audio);
    return audio;
}

/** Runs inside the isolated worker; the caller owns and cleans its staging directory. */
export async function synthesizeToFile(text: string, outputPath: string, config: TtsConfig, signal?: AbortSignal): Promise<{ size: number; duration: number }> {
    const issues = getTtsConfigIssues(config);
    if (issues.length) throw new Error(issues.join("; "));
    if (typeof text !== "string" || !text.trim()) throw new Error("TTS text must not be empty");
    const resolved = resolveTtsConfig(config);
    const realtime = resolved.provider === "openai" && resolved.openai.api_mode === "realtime";
    if (realtime) await ensureFfmpegAvailable(signal);
    const chunks = splitTextForTts(text, realtime ? 1500 : resolved.provider === "openai" ? 4000 : 5000);
    let size = 0;
    let duration = 0;
    await writeFile(outputPath, "");
    for (let i = 0; i < chunks.length; i++) {
        signal?.throwIfAborted();
        if (!chunks[i].trim()) continue;
        let audio: Buffer;
        if (resolved.provider === "openai") {
            audio = await synthesizeOpenAiChunk(chunks[i], resolved.openai, signal);
        } else {
            const chunkPath = `${outputPath}.part${i}`;
            try {
                const tts = new EdgeTTS();
                await tts.synthesize(chunks[i], resolved.voice, { rate: resolved.rate, pitch: resolved.pitch });
                await tts.toFile(chunkPath);
                audio = await readFile(`${chunkPath}.mp3`);
            } finally {
                await unlink(`${chunkPath}.mp3`).catch(() => {});
            }
        }
        audio = mp3AudioFrames(audio);
        duration += mp3Duration(audio);
        size += audio.length;
        await appendFile(outputPath, audio);
    }
    return { size, duration: Math.max(1, Math.round(duration)) };
}
