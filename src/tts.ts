import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { TtsConfig } from "./types.js";
import { resolveNodeScriptCommand } from "./node-script.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Synthesize text to an MP3 file with the selected provider in a child process.
 * This prevents TTS from blocking the main event loop (Express).
 * Returns the duration in seconds.
 */
export async function synthesize(
    text: string,
    outputPath: string,
    config: TtsConfig,
    options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<number> {
    mkdirSync(dirname(outputPath), { recursive: true });

    const { command, args } = resolveNodeScriptCommand(__dirname, "tts-worker.js");

    const stagingDir = await mkdtemp(join(dirname(outputPath), ".tts-"));
    const stagedOutput = join(stagingDir, "episode.mp3");
    try {
        const duration = await new Promise<number>((resolve, reject) => {
            const child = spawn(command, args, {
                stdio: ["pipe", "pipe", "inherit"],
                signal: options.signal,
                timeout: options.timeoutMs ?? 30 * 60_000,
            });

            let stdout = "";

            child.stdout!.on("data", (data: Buffer) => {
                stdout += data.toString();
            });

            let workerError: string | undefined;
            child.on("error", (err) => {
                workerError = err.name === "AbortError" ? "TTS preview cancelled" : "Could not start the TTS worker";
            });

            child.on("close", (code, signal) => {
                try {
                    const result = JSON.parse(stdout);
                    if (result.error) { reject(new Error(result.error)); return; }
                    if (workerError || code !== 0 || !Number.isFinite(result.duration) || result.duration <= 0) {
                        reject(new Error(workerError ?? `TTS worker stopped (${signal ?? code})`));
                        return;
                    }
                    resolve(result.duration);
                } catch {
                    reject(new Error(workerError ?? (signal ? "TTS worker timed out or was stopped" : "TTS worker returned invalid output")));
                }
            });

            // Send input via stdin
            const input = JSON.stringify({
                text,
                outputPath: stagedOutput,
                config,
            });
            child.stdin!.on("error", () => { workerError ??= "TTS worker input failed"; });
            child.stdin!.write(input);
            child.stdin!.end();
        });
        await rename(stagedOutput, outputPath);
        return duration;
    } finally {
        await rm(stagingDir, { recursive: true, force: true });
    }
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
