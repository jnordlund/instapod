import { franc } from "franc-min";
import type { TranslationConfig } from "./types.js";

/** ISO‑639‑3 codes for common target language names. */
const LANG_NAME_TO_CODE: Record<string, string> = {
    svenska: "swe",
    swedish: "swe",
    english: "eng",
    engelska: "eng",
    deutsch: "deu",
    tyska: "deu",
    french: "fra",
    franska: "fra",
    spanish: "spa",
    spanska: "spa",
    norwegian: "nor",
    norska: "nor",
    danish: "dan",
    danska: "dan",
};

const MAX_CHARS_PER_CHUNK = 12_000; // ~4 000 tokens

/**
 * Detect language using franc-min. Returns ISO‑639‑3 code.
 */
export function detectLanguage(text: string): string {
    return franc(text);
}

/**
 * Translate text via an OpenAI-compatible chat completions API.
 * Skips translation if the text is already in the target language.
 */
export async function translateText(
    text: string,
    config: TranslationConfig
): Promise<string> {
    if (config.skip_if_same) {
        const detected = detectLanguage(text);
        const targetCode =
            LANG_NAME_TO_CODE[config.target_language.toLowerCase()] ?? "";
        if (detected === targetCode) {
            return text;
        }
    }

    const chunks = splitIntoChunks(text, MAX_CHARS_PER_CHUNK);
    const translated: string[] = [];

    for (const chunk of chunks) {
        const result = await callChatCompletions(chunk, config);
        translated.push(result);
    }

    return translated.join("\n\n");
}

/**
 * Translate a title string (short text, single API call).
 */
export async function translateTitle(
    title: string,
    config: TranslationConfig
): Promise<string> {
    if (config.skip_if_same) {
        const detected = detectLanguage(title);
        const targetCode =
            LANG_NAME_TO_CODE[config.target_language.toLowerCase()] ?? "";
        if (detected === targetCode) {
            return title;
        }
    }
    return callChatCompletions(title, config, true);
}

async function callChatCompletions(
    text: string,
    config: TranslationConfig,
    isTitle = false
): Promise<string> {
    const systemPrompt = isTitle
        ? `You are a translator. Translate the following title to ${config.target_language}. Return only the translated title, nothing else.`
        : `You are a translator. Translate the following text to ${config.target_language}. Preserve paragraph breaks. Return only the translated text, nothing else.`;

    const url = `${config.api_base.replace(/\/$/, "")}/chat/completions`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${config.api_key}`,
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: text },
                    ],
                    temperature: 0.3,
                }),
                signal: AbortSignal.timeout(120_000), // 120s timeout
            });

            if (!response.ok) {
                const body = await response.text();
                throw new Error(
                    `Translation API error ${response.status}: ${body}`
                );
            }

            const data = (await response.json()) as {
                choices: Array<{ message: { content: string } }>;
            };

            return data.choices[0].message.content.trim();
        } catch (err) {
            lastError = err as Error;
            const cause = (err as any)?.cause;
            console.error(`[translator] Attempt ${attempt + 1} failed: ${(err as Error).message}${cause ? ` (cause: ${cause.code ?? cause.message})` : ""}`);
            // Exponential backoff: 1s, 2s, 4s
            const delay = 1000 * Math.pow(2, attempt);
            await new Promise((r) => setTimeout(r, delay));
        }
    }

    throw new Error(
        `Translation failed after 3 attempts: ${lastError?.message}`
    );
}

/**
 * Split text into chunks at sentence boundaries.
 */
function splitIntoChunks(text: string, maxChars: number): string[] {
    if (text.length <= maxChars) return [text];

    const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) ?? [text];
    const chunks: string[] = [];
    let current = "";

    for (const sentence of sentences) {
        if (current.length + sentence.length > maxChars && current.length > 0) {
            chunks.push(current.trim());
            current = "";
        }
        current += sentence;
    }

    if (current.trim().length > 0) {
        chunks.push(current.trim());
    }

    return chunks;
}
