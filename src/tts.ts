import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TtsConfig } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Synthesize text to an mp3 file using edge-tts in a child process.
 * This prevents TTS from blocking the main event loop (Express).
 * Returns the duration in seconds.
 */
export async function synthesize(
    text: string,
    outputPath: string,
    config: TtsConfig
): Promise<number> {
    mkdirSync(dirname(outputPath), { recursive: true });

    const workerPath = join(__dirname, "tts-worker.js");

    return new Promise<number>((resolve, reject) => {
        const child = spawn("node", [workerPath], {
            stdio: ["pipe", "pipe", "inherit"],
        });

        let stdout = "";

        child.stdout!.on("data", (data: Buffer) => {
            stdout += data.toString();
        });

        child.on("error", (err) => {
            reject(new Error(`TTS worker error: ${err.message}`));
        });

        child.on("close", (code) => {
            if (code !== 0) {
                reject(new Error(`TTS worker exited with code ${code}`));
                return;
            }

            try {
                const result = JSON.parse(stdout);
                const estimatedDuration = Math.round(result.size / 16000);
                resolve(estimatedDuration);
            } catch {
                reject(new Error(`TTS worker returned invalid output: ${stdout}`));
            }
        });

        // Send input via stdin
        const input = JSON.stringify({
            text,
            outputPath,
            voice: config.voice,
            rate: config.rate,
            pitch: config.pitch,
        });
        child.stdin!.write(input);
        child.stdin!.end();
    });
}

/**
 * Generate a safe filename from a title and bookmark ID.
 */
export function generateFilename(bookmarkId: string, title: string): string {
    const safe = title
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // strip diacritics
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);

    return `${bookmarkId}-${safe}.mp3`;
}
