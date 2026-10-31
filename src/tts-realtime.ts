import WebSocket from "ws";
import type { OpenAiTtsConfig } from "./types.js";
import { assertNarrationTranscript, narrationInstructions } from "./tts-text.js";

function realtimeError(status?: number): Error {
    const hint = status === 401 ? "Check the TTS API key."
        : status === 403 ? "Check model access and API key permissions."
        : status === 429 ? "Check API quota and rate limits, then retry."
        : "Check the Realtime API base URL, model, voice, and supported settings.";
    return new Error(`Realtime TTS API error${status ? ` (${status})` : ""}. ${hint}`);
}

/** One isolated GA Realtime session per text chunk. Returns mono PCM16 at 24 kHz. */
export async function requestRealtimeAudio(
    text: string, config: OpenAiTtsConfig, options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<Buffer> {
    options.signal?.throwIfAborted();
    const url = new URL(`${config.api_base.replace(/\/+$/, "")}/realtime`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("model", config.model);
    const headers: Record<string, string> = {};
    if (config.api_key.trim()) headers.Authorization = `Bearer ${config.api_key}`;
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, { headers, handshakeTimeout: 15_000, maxPayload: 8 * 1024 * 1024, followRedirects: false });
        const audio = new Map<string, Buffer[]>();
        let totalSize = 0;
        let phase: "created" | "updated" | "response" = "created";
        let responseId: string | undefined;
        let settled = false;
        const finish = (error?: Error, pcm?: Buffer) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", abort);
            // Termination is bounded even when a compatible service ignores the close handshake.
            ws.terminate();
            if (error) reject(error); else resolve(pcm!);
        };
        const abort = () => finish(new Error("TTS generation cancelled"));
        const timer = setTimeout(() => finish(new Error("Realtime TTS timed out. Retry or use shorter text.")), options.timeoutMs ?? 300_000);
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
        ws.on("unexpected-response", (_request, response) => {
            response.destroy();
            finish(realtimeError(response.statusCode));
        });
        ws.on("error", () => finish(new Error("Could not connect to the Realtime TTS API. Check the base URL, WebSocket support, and network connection.")));
        ws.on("close", () => finish(new Error("Realtime TTS connection closed before narration completed")));
        ws.on("message", (data, binary) => {
            if (settled) return;
            try {
                if (binary) throw new Error("Realtime TTS returned an unsupported binary event");
                const event = JSON.parse(data.toString());
                if (!event || typeof event !== "object") throw new Error("Realtime TTS returned an invalid event");
                if (event.type === "error") {
                    // Never expose upstream messages: they can contain credentials or article text.
                    const code = event.error?.code;
                    throw realtimeError(code === "invalid_api_key" ? 401
                        : ["rate_limit_exceeded", "insufficient_quota"].includes(code) ? 429 : undefined);
                }
                if (event.type === "session.created" && phase === "created") {
                    phase = "updated";
                    ws.send(JSON.stringify({ type: "session.update", session: {
                        type: "realtime", output_modalities: ["audio"],
                        instructions: narrationInstructions(config.instructions), tools: [],
                        audio: { input: { turn_detection: null }, output: {
                            format: { type: "audio/pcm", rate: 24000 }, voice: config.voice, speed: config.speed,
                        } },
                    } }));
                } else if (event.type === "session.updated" && phase === "updated") {
                    const format = event.session?.audio?.output?.format;
                    if (format?.type !== "audio/pcm" || format.rate !== 24000) {
                        throw new Error("Realtime TTS did not accept the required 24 kHz PCM audio format");
                    }
                    phase = "response";
                    ws.send(JSON.stringify({ type: "response.create", response: {
                        conversation: "none", output_modalities: ["audio"],
                        input: [{ type: "message", role: "user", content: [{ type: "input_text", text }] }],
                    } }));
                } else if (event.type === "response.created" && phase === "response") {
                    if (responseId || typeof event.response?.id !== "string") throw new Error("Realtime TTS returned an unexpected response");
                    responseId = event.response.id;
                } else if (event.type === "response.output_audio.delta") {
                    if (!responseId || event.response_id !== responseId || typeof event.item_id !== "string" || !Number.isInteger(event.content_index)) {
                        throw new Error("Realtime TTS returned audio for an unexpected response");
                    }
                    if (typeof event.delta !== "string" || !event.delta || event.delta.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(event.delta)) {
                        throw new Error("Realtime TTS returned invalid base64 audio");
                    }
                    const bytes = Buffer.from(event.delta, "base64");
                    totalSize += bytes.length;
                    if (totalSize > 48 * 1024 * 1024) throw new Error("Realtime TTS audio exceeded its size limit");
                    const key = JSON.stringify([event.item_id, event.content_index]);
                    const chunks = audio.get(key) ?? [];
                    chunks.push(bytes);
                    audio.set(key, chunks);
                } else if (event.type === "response.done") {
                    const response = event.response;
                    if (!responseId || response?.id !== responseId || response.status !== "completed") {
                        throw new Error("Realtime TTS did not finish the narration; no episode was produced. Try shorter text or another model.");
                    }
                    const ordered: Buffer[] = [];
                    const transcripts: string[] = [];
                    for (const item of response.output ?? []) {
                        if (item.type !== "message" || item.role !== "assistant") continue;
                        for (const [index, part] of (item.content ?? []).entries()) {
                            if (part.type !== "output_audio") throw new Error("Realtime TTS returned a non-audio narration");
                            const key = JSON.stringify([item.id, index]);
                            const chunks = audio.get(key);
                            if (!chunks?.length) throw new Error("Realtime TTS returned no audio for its transcript");
                            const bytes = Buffer.concat(chunks);
                            if (!bytes.length || bytes.length % 2) throw new Error("Realtime TTS returned invalid PCM audio");
                            if (typeof part.transcript !== "string" || !part.transcript.trim()) throw new Error("Realtime TTS returned no narration transcript");
                            ordered.push(bytes);
                            transcripts.push(part.transcript);
                            audio.delete(key);
                        }
                    }
                    if (!ordered.length || audio.size) throw new Error("Realtime TTS returned incomplete audio");
                    assertNarrationTranscript(text, transcripts.join(" "));
                    finish(undefined, Buffer.concat(ordered));
                }
            } catch (err) {
                finish(err instanceof SyntaxError || err instanceof TypeError
                    ? new Error("Realtime TTS returned an invalid event")
                    : err instanceof Error ? err : new Error("Realtime TTS generation failed"));
            }
        });
    });
}
