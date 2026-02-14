/**
 * TTS Worker — runs in a child process to avoid blocking the main event loop.
 * Usage: node tts-worker.js <text> <outputPath> <voice> <rate> <pitch>
 * Receives text via stdin to avoid argv length limits.
 */
import { EdgeTTS } from "@andresaya/edge-tts";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const MAX_CHARS_PER_CHUNK = 5000;

async function main() {
    // Read arguments from stdin (JSON)
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    const { text, outputPath, voice, rate, pitch } = input;

    mkdirSync(dirname(outputPath), { recursive: true });

    const textChunks = splitTextForTTS(text, MAX_CHARS_PER_CHUNK);

    if (textChunks.length === 1) {
        await synthesizeChunk(textChunks[0], outputPath, voice, rate, pitch);
    } else {
        console.error(`[tts] Splitting into ${textChunks.length} chunks for TTS`);
        const chunkFiles: string[] = [];

        for (let i = 0; i < textChunks.length; i++) {
            const chunkPath = outputPath.replace(/\.mp3$/, `.part${i}.mp3`);
            await synthesizeChunk(textChunks[i], chunkPath, voice, rate, pitch);
            chunkFiles.push(chunkPath);
        }

        const buffers = await Promise.all(chunkFiles.map((f) => readFile(f)));
        await writeFile(outputPath, Buffer.concat(buffers));
        await Promise.all(chunkFiles.map((f) => unlink(f).catch(() => { })));
    }

    // Output file size for duration estimation
    const { stat } = await import("node:fs/promises");
    const fileInfo = await stat(outputPath);
    process.stdout.write(JSON.stringify({ size: fileInfo.size }));
}

async function synthesizeChunk(
    text: string,
    outputPath: string,
    voice: string,
    rate: string,
    pitch: string
): Promise<void> {
    const tts = new EdgeTTS();
    await tts.synthesize(text, voice, { rate, pitch });
    const basePath = outputPath.replace(/\.mp3$/, "");
    await tts.toFile(basePath);
}

function splitTextForTTS(text: string, maxChars: number): string[] {
    if (text.length <= maxChars) return [text];

    const paragraphs = text.split(/\n\n+/);
    const chunks: string[] = [];
    let current = "";

    for (const paragraph of paragraphs) {
        if (current.length + paragraph.length + 2 > maxChars && current.length > 0) {
            chunks.push(current.trim());
            current = "";
        }

        if (paragraph.length > maxChars) {
            if (current.length > 0) {
                chunks.push(current.trim());
                current = "";
            }
            const sentences = paragraph.match(/[^.!?]+[.!?]+[\s]*/g) ?? [paragraph];
            for (const sentence of sentences) {
                if (current.length + sentence.length > maxChars && current.length > 0) {
                    chunks.push(current.trim());
                    current = "";
                }
                current += sentence;
            }
        } else {
            current += (current ? "\n\n" : "") + paragraph;
        }
    }

    if (current.trim().length > 0) {
        chunks.push(current.trim());
    }

    return chunks;
}

main().catch((err) => {
    console.error("[tts-worker] Fatal:", err);
    process.exit(1);
});
