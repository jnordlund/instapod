import { spawn } from "node:child_process";

/** No shell, temporary audio files, or upstream text in encoder diagnostics. */
async function runFfmpeg(args: string[], input?: Buffer, signal?: AbortSignal): Promise<Buffer> {
    const timeout = AbortSignal.timeout(30_000);
    const controller = new AbortController();
    const combined = AbortSignal.any([timeout, controller.signal, ...(signal ? [signal] : [])]);
    return new Promise((resolve, reject) => {
        const child = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "ignore"], signal: combined });
        const output: Buffer[] = [];
        let size = 0;
        let failure: Error | undefined;
        child.on("error", (err: NodeJS.ErrnoException) => {
            failure ??= new Error(err.code === "ENOENT"
                ? "Realtime TTS requires FFmpeg. Install ffmpeg locally or rebuild the Docker image."
                : signal?.aborted ? "TTS generation cancelled"
                : timeout.aborted ? "Realtime MP3 encoding timed out"
                : "Could not run the Realtime MP3 encoder");
        });
        child.stdout.on("data", (data: Buffer) => {
            size += data.length;
            if (size > 32 * 1024 * 1024) {
                failure = new Error("Realtime MP3 output exceeded its size limit");
                controller.abort();
            } else output.push(data);
        });
        child.on("close", (code) => {
            if (failure || code !== 0) reject(failure ?? new Error("Realtime MP3 encoding failed"));
            else resolve(Buffer.concat(output));
        });
        child.stdin.on("error", () => {}); // Early exit is reported by error/close.
        child.stdin.end(input);
    });
}

/** Check before opening a paid API session. Only Realtime needs this dependency. */
export async function ensureFfmpegAvailable(signal?: AbortSignal): Promise<void> {
    await runFfmpeg(["-version"], undefined, signal);
}

export function encodeRealtimeMp3(pcm: Buffer, signal?: AbortSignal): Promise<Buffer> {
    return runFfmpeg([
        "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "pipe:0",
        "-codec:a", "libmp3lame", "-b:a", "128k", "-write_xing", "0", "-id3v2_version", "0", "-f", "mp3", "pipe:1",
    ], pcm, signal);
}
