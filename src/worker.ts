import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { AppConfig } from "./types.js";
import { InstapaperClient } from "./instapaper.js";
import { parseArticle } from "./parser.js";
import { translateText, translateTitle } from "./translator.js";
import { synthesize, generateFilename } from "./tts.js";
import { StateManager } from "./state.js";

const MAX_CONCURRENCY = 2;

/**
 * Run the full pipeline: fetch → parse → translate → TTS → update state.
 */
export async function runPipeline(
    config: AppConfig,
    state: StateManager
): Promise<void> {
    const client = new InstapaperClient(config.instapaper);

    console.log("[worker] Fetching bookmarks from Instapaper...");

    // Fetch bookmarks, filtered by tag if configured
    let bookmarks;

    if (config.filters.tags.length > 0) {
        console.log(`[worker] Filtering for tags: ${JSON.stringify(config.filters.tags)}`);

        const taggedBookmarks = [];
        for (const tag of config.filters.tags) {
            const tagBookmarks = await client.getBookmarks({ tag });
            console.log(`[worker] Tag "${tag}": ${tagBookmarks.length} bookmark(s)`);
            taggedBookmarks.push(...tagBookmarks);
        }

        // Deduplicate by bookmark_id
        const seen = new Set<number>();
        bookmarks = taggedBookmarks.filter((b) => {
            if (seen.has(b.bookmark_id)) return false;
            seen.add(b.bookmark_id);
            return true;
        });
    } else {
        bookmarks = await client.getBookmarks();
    }

    // Filter out already-processed bookmarks
    const newBookmarks = bookmarks.filter(
        (b) => !state.isProcessed(String(b.bookmark_id))
    );

    if (newBookmarks.length === 0) {
        console.log("[worker] No new bookmarks to process");
        state.updateLastRun();
        return;
    }

    console.log(`[worker] Found ${newBookmarks.length} new bookmark(s) to process`);

    const audioDir = join(config.data_dir, "audio");
    mkdirSync(audioDir, { recursive: true });

    // Process with limited concurrency
    const queue = [...newBookmarks];
    const running: Promise<void>[] = [];

    while (queue.length > 0 || running.length > 0) {
        while (running.length < MAX_CONCURRENCY && queue.length > 0) {
            const bookmark = queue.shift()!;
            const task = processBookmark(bookmark, client, config, state, audioDir);
            running.push(task);
        }

        if (running.length > 0) {
            await Promise.race(running);
            // Remove completed promises
            for (let i = running.length - 1; i >= 0; i--) {
                // Check if promise is settled by racing with a resolved promise
                const settled = await Promise.race([
                    running[i].then(() => true).catch(() => true),
                    Promise.resolve(false),
                ]);
                if (settled) {
                    running.splice(i, 1);
                }
            }
        }
    }

    state.updateLastRun();
    console.log("[worker] Pipeline run complete");
}

async function processBookmark(
    bookmark: { bookmark_id: number; title: string; url: string },
    client: InstapaperClient,
    config: AppConfig,
    state: StateManager,
    audioDir: string
): Promise<void> {
    const id = String(bookmark.bookmark_id);

    try {
        console.log(`[worker] Processing: "${bookmark.title}" (${id})`);

        // 1. Fetch HTML text
        const html = await client.getBookmarkText(id);

        // 2. Parse
        const parsed = parseArticle(id, bookmark.title, bookmark.url, html);

        // 3. Translate if needed
        let translatedTitle = parsed.title;
        let textForTTS = parsed.fullText;

        if (config.translation.api_key) {
            translatedTitle = await translateTitle(parsed.title, config.translation);
            const translatedBody = await translateText(parsed.body, config.translation);
            const source = parsed.source;
            const intro = source
                ? `En artikel från ${source}. ${translatedTitle}.`
                : `${translatedTitle}.`;
            textForTTS = `${intro}\n\n${translatedBody}`;
        }

        // 4. TTS → mp3
        const filename = generateFilename(id, translatedTitle);
        const outputPath = join(audioDir, filename);
        const duration = await synthesize(textForTTS, outputPath, config.tts);

        // 5. Update state
        state.addProcessed({
            bookmarkId: id,
            title: translatedTitle,
            source: parsed.source,
            filename,
            duration,
            pubDate: new Date().toISOString(),
        });

        console.log(`[worker] ✓ Completed: "${translatedTitle}" (${duration}s)`);
    } catch (err) {
        console.error(`[worker] ✗ Failed to process bookmark ${id}:`, err);
    }
}
