/** Preserve every character, including a trailing sentence without punctuation. */
export function splitTextForTts(text: string, maxChars: number): string[] {
    if (!Number.isInteger(maxChars) || maxChars < 2) throw new Error("Invalid TTS chunk size");
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > maxChars) {
        const window = remaining.slice(0, maxChars);
        let boundary = window.lastIndexOf("\n\n") + 2;
        if (boundary < maxChars / 2) {
            const sentences = [...window.matchAll(/[.!?][\s]+/gu)];
            const last = sentences.at(-1);
            boundary = last ? last.index! + last[0].length : 0;
        }
        if (boundary < maxChars / 2) {
            boundary = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\n")) + 1;
        }
        if (boundary < maxChars / 2) boundary = maxChars;
        // Do not split a Unicode surrogate pair at a hard boundary.
        const lastCode = remaining.charCodeAt(boundary - 1);
        if (lastCode >= 0xd800 && lastCode <= 0xdbff) boundary--;
        chunks.push(remaining.slice(0, boundary));
        remaining = remaining.slice(boundary);
    }
    if (remaining) chunks.push(remaining);
    return chunks;
}

export function normalizeNarrationText(text: string): string {
    return text.normalize("NFKC").toLowerCase().replace(/\p{P}+/gu, " ").replace(/\s+/gu, " ").trim();
}

export function assertNarrationTranscript(input: string, transcript: unknown): void {
    if (typeof transcript !== "string" || !transcript.trim()) {
        throw new Error("Audio API returned no narration transcript");
    }
    if (normalizeNarrationText(input) !== normalizeNarrationText(transcript)) {
        throw new Error("Audio API narration transcript differs from the article; no episode was produced. Try another model or use Edge TTS.");
    }
}
