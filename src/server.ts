import express from "express";
import { join, resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import type { AppConfig } from "./types.js";
import { StateManager } from "./state.js";
import { generateFeed } from "./feed.js";
import { createAdminRouter } from "./admin.js";

export function createServer(
    config: AppConfig,
    state: StateManager,
    triggerRun: () => Promise<void>
) {
    const app = express();
    app.set("trust proxy", true);  // Needed for correct req.ip behind Docker/nginx
    const audioDir = resolve(join(config.data_dir, "audio"));
    const feedPath = join(config.data_dir, "feed.xml");

    // Ensure audio directory exists
    mkdirSync(audioDir, { recursive: true });

    // JSON body parsing for admin API (limit size to prevent abuse)
    app.use(express.json({ limit: "1mb" }));

    // Mutable config reference for admin updates
    let currentConfig = config;
    const getConfig = () => currentConfig;
    const setConfig = (c: AppConfig) => { currentConfig = c; };

    // ── Admin routes ──
    app.use(createAdminRouter(getConfig, setConfig, state, triggerRun));

    /**
     * GET /feed — serve the podcast RSS feed
     */
    app.get("/feed", (_req, res) => {
        try {
            const episodes = state.getProcessedBookmarks();
            const feedXml = generateFeed(currentConfig, episodes);

            // Also persist to disk
            writeFileSync(feedPath, feedXml, "utf-8");

            res.set("Content-Type", "application/rss+xml; charset=utf-8");
            res.send(feedXml);
        } catch (err) {
            console.error("Error generating feed:", err);
            res.status(500).json({ error: "Failed to generate feed" });
        }
    });

    /**
     * GET /audio/:filename — serve mp3 files
     */
    app.get("/audio/:filename", (req, res) => {
        const filename = req.params.filename;

        // Validate filename to prevent path traversal
        if (!/^[a-zA-Z0-9_\-]+\.mp3$/.test(filename)) {
            return res.status(400).json({ error: "Invalid filename" });
        }

        const filePath = join(audioDir, filename);

        // Double-check resolved path stays within audioDir
        if (!resolve(filePath).startsWith(resolve(audioDir) + "/")) {
            return res.status(400).json({ error: "Invalid filename" });
        }

        res.sendFile(filePath, (err) => {
            if (err) {
                res.status(404).json({ error: "Audio file not found" });
            }
        });
    });

    /**
     * GET /health — healthcheck endpoint
     */
    app.get("/health", (_req, res) => {
        res.json({
            status: "ok",
            lastRun: state.getLastRun(),
            episodeCount: state.getProcessedBookmarks().length,
        });
    });

    return app;
}
