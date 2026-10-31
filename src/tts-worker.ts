/** Isolated speech worker. Text and credentials travel over stdin, never argv. */
import { synthesizeToFile } from "./tts-engine.js";

async function main() {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const { text, outputPath, config } = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    process.stdout.write(JSON.stringify(await synthesizeToFile(text, outputPath, config)));
}

main().catch((err) => {
    process.stdout.write(JSON.stringify({ error: err instanceof Error ? err.message : "TTS generation failed" }));
    process.exitCode = 1;
});
