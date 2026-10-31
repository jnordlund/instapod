import type { OpenAiTtsConfig } from "./types.js";

// OpenAI Docs checked 2026-10-31. Suggestions, not a restriction on compatible services.
export const TTS_VOICE_SUGGESTIONS = {
    "audio-chat": ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"],
    realtime: ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"],
    speech: ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"],
    "tts-1": ["alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer"],
};

/** List model IDs only; /models does not establish audio capabilities or voice support. */
export async function listTtsModels(
    config: Pick<OpenAiTtsConfig, "api_base" | "api_key">,
    signal?: AbortSignal
): Promise<string[]> {
    let base: URL;
    try {
        base = new URL(config.api_base);
        if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error();
    } catch {
        throw new Error("Enter a valid TTS API base URL before fetching models.");
    }
    if (base.hostname === "api.openai.com" && !config.api_key.trim()) {
        throw new Error("Enter the TTS API key before fetching OpenAI models.");
    }
    const headers: Record<string, string> = {};
    if (config.api_key.trim()) headers.Authorization = `Bearer ${config.api_key}`;
    const timeout = AbortSignal.timeout(15_000);
    try {
        const response = await fetch(`${base.toString().replace(/\/+$/, "")}/models`, {
            headers, redirect: "error",
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (!response.ok) {
            await response.body?.cancel();
            const hint = response.status === 401 ? "Check the TTS API key."
                : response.status === 403 ? "The key may lack permission to list models. You can still enter a model manually."
                : response.status === 404 ? "This service does not expose a model list. Enter a model manually."
                : response.status === 429 ? "Model listing is rate-limited. Try again later."
                : "Could not list models. Enter a model manually or try again later.";
            throw new Error(`Models API error (${response.status}). ${hint}`);
        }
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray(body.data)) {
            throw new Error("The API returned an unsupported model list. Enter a model manually.");
        }
        const ids = body.data.flatMap((model: unknown) => {
            if (!model || typeof model !== "object" || !("id" in model) || typeof model.id !== "string" || !model.id.trim()) return [];
            return [model.id];
        });
        return [...new Set(ids)].sort();
    } catch (err) {
        if (timeout.aborted) throw new Error("Fetching TTS models timed out. Try again or enter a model manually.");
        if (signal?.aborted) throw new Error("Model lookup cancelled.");
        if (err instanceof SyntaxError) throw new Error("The API returned an invalid model list. Enter a model manually.");
        if (err instanceof TypeError) throw new Error("Could not reach the models API. Check the TTS base URL or enter a model manually.");
        throw err;
    }
}
