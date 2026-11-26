import express from "express";
import { join, resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import type { AppConfig } from "./types.js";
import { StateManager } from "./state.js";
import { generateFeed } from "./feed.js";
import { createAdminRouter } from "./admin.js";
import { renderLandingPage } from "./landing.js";
import { isFeedAccessAllowed, isFeedAccessEnabled } from "./feed-access.js";
import { sendAudio } from "./audio.js";
import type { ImportRunner } from "./scheduler.js";

export function createServer(
    config: AppConfig,
    state: StateManager,
    imports: ImportRunner,
    onConfigChanged?: (config: AppConfig) => void
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
    app.use(createAdminRouter(getConfig, setConfig, state, imports, onConfigChanged));

    app.get("/", (_req, res) => {
        res.set("Content-Type", "text/html; charset=utf-8");
        res.send(renderLandingPage());
    });

    app.get("/favicon.ico", (_req, res) => {
        res.status(204).end();
    });

    function sendFeed(res: express.Response): void {
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
    }

    /**
     * GET /feed — serve the podcast RSS feed when token protection is disabled
     */
    app.get("/feed", (_req, res) => {
        if (isFeedAccessEnabled(currentConfig)) {
            res.status(404).end();
            return;
        }
        sendFeed(res);
    });

    /**
     * GET /:token/feed — serve the podcast RSS feed when token protection is enabled
     */
    app.get("/:token/feed", (req, res) => {
        if (!isFeedAccessAllowed(currentConfig, req.params.token)) {
            res.status(404).end();
            return;
        }
        sendFeed(res);
    });

    /**
     * GET /audio/:filename — serve mp3 files when token protection is disabled
     */
    app.get("/audio/:filename", (req, res, next) => {
        if (isFeedAccessEnabled(currentConfig)) {
            res.status(404).end();
            return;
        }
        sendAudio(res, next, audioDir, req.params.filename);
    });

    /**
     * GET /:token/audio/:filename — serve mp3 files when token protection is enabled
     */
    app.get("/:token/audio/:filename", (req, res, next) => {
        if (!isFeedAccessAllowed(currentConfig, req.params.token)) {
            res.status(404).end();
            return;
        }
        sendAudio(res, next, audioDir, req.params.filename);
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
