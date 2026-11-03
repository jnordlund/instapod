/** Isolated speech worker. Text and credentials travel over stdin, never argv. */
import { synthesizeToFile } from "./tts-engine.js";

async function main() {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const { text, outputPath, config } = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    const controller = new AbortController();
    const abort = () => controller.abort();
    // Realtime owns an encoder subprocess. Let it close the socket and encoder before exiting.
    const realtime = config.provider === "openai" && config.openai?.api_mode === "realtime";
    if (realtime) process.once("SIGTERM", abort);
    try {
        process.stdout.write(JSON.stringify(await synthesizeToFile(text, outputPath, config, controller.signal)));
    } finally {
        if (realtime) process.removeListener("SIGTERM", abort);
    }
}

main().catch((err) => {
    process.stdout.write(JSON.stringify({ error: err instanceof Error ? err.message : "TTS generation failed" }));
    process.exitCode = 1;
});
