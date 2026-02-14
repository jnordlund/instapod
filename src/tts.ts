import { EdgeTTS } from "@andresaya/edge-tts";
import { writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { TtsConfig } from "./types.js";

/**
 * Synthesize text to an mp3 file using edge-tts.
 * Returns the duration in seconds.
 */
export async function synthesize(
    text: string,
    outputPath: string,
    config: TtsConfig
): Promise<number> {
    mkdirSync(dirname(outputPath), { recursive: true });

    const tts = new EdgeTTS();
    await tts.synthesize(text, config.voice, {
        rate: config.rate,
        pitch: config.pitch,
    });
    await tts.toFile(outputPath);

    // Estimate duration from file size (mp3 at ~128kbps ≈ 16 KB/s)
    const fileInfo = await stat(outputPath);
    const estimatedDuration = Math.round(fileInfo.size / 16000);

    return estimatedDuration;
}

/**
 * Generate a safe filename from a title and bookmark ID.
 */
export function generateFilename(bookmarkId: string, title: string): string {
    const safe = title
        .toLowerCase()
        .replace(/[^a-z0-9åäöü]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);

    return `${bookmarkId}-${safe}.mp3`;
}
