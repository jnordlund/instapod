import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppConfig, ProcessedBookmark } from "./types.js";
import type { StateManager } from "./state.js";
import { checkSpotifyEpisodeStatus, resolveSpotifyCliPath, uploadEpisodeToSpotify } from "./spotify.js";
import { enqueueWork } from "./work-queue.js";
import { addLog } from "./logs.js";

export interface SpotifyRetryJob {
    status: "queued" | "running";
    mode: "upload" | "status";
}

export class SpotifyRetryError extends Error {
    constructor(public readonly statusCode: number, message: string) { super(message); }
}

export function spotifyRetryIssue(config: AppConfig): string | undefined {
    if (!config.spotify_upload?.enabled) return "Enable Spotify uploads in Configuration before retrying.";
    if (!config.spotify_upload.cli_path?.trim()) return "Set the Spotify CLI path in Configuration before retrying.";
    const cliPath = resolveSpotifyCliPath(config);
    if ((cliPath.includes("/") || cliPath.includes("\\")) && !existsSync(cliPath)) {
        return "Install the Spotify CLI in Setup or correct its path in Configuration before retrying.";
    }
    return undefined;
}

export class SpotifyRetryManager {
    private readonly jobs = new Map<string, SpotifyRetryJob>();

    constructor(private readonly getConfig: () => AppConfig, private readonly state: StateManager) {}

    getJob(id: string): SpotifyRetryJob | undefined { return this.jobs.get(id); }

    request(id: string, confirmed: boolean): SpotifyRetryJob {
        if (this.jobs.has(id)) throw new SpotifyRetryError(409, "A Spotify retry is already queued or running for this episode.");
        const episode = this.state.getProcessedBookmarks().find(ep => ep.bookmarkId === id);
        if (!episode) throw new SpotifyRetryError(404, "Episode not found");
        if (!episode.spotify?.error) throw new SpotifyRetryError(409, "Only failed Spotify attempts can be retried.");
        const mode = episode.spotify.episodeId || episode.spotify.episodeUri ? "status" : "upload";
        this.validate(this.getConfig(), episode, mode);
        if (mode === "upload" && !confirmed) {
            throw new SpotifyRetryError(409, "The previous upload may have succeeded. Retrying could create a duplicate Spotify episode. Continue?");
        }
        const job: SpotifyRetryJob = { status: "queued", mode };
        this.jobs.set(id, job);
        void enqueueWork(async () => {
            job.status = "running";
            try {
                // Configuration and disk state may have changed while waiting for the pipeline.
                const config = this.getConfig();
                const current = this.state.getProcessedBookmarks().find(ep => ep.bookmarkId === id);
                if (!current) throw new Error("Episode not found");
                this.validate(config, current, mode);
                const spotify = mode === "status"
                    ? await checkSpotifyEpisodeStatus(config, current.spotify!)
                    : await uploadEpisodeToSpotify(config, {
                        filePath: this.audioPath(config, current), title: current.title, source: current.source,
                    });
                this.state.updateSpotify(id, spotify);
                addLog(spotify.error ? "error" : "info", `Spotify ${mode} retry for ${id}: ${spotify.error || "completed"}`, "spotify");
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                const current = this.state.getProcessedBookmarks().find(ep => ep.bookmarkId === id);
                if (current) this.state.updateSpotify(id, { ...current.spotify, error: message });
                addLog("error", `Spotify ${mode} retry for ${id}: ${message}`, "spotify");
            } finally {
                this.jobs.delete(id);
            }
        }).catch(err => {
            this.jobs.delete(id);
            addLog("error", `Could not save Spotify retry for ${id}: ${String(err)}`, "spotify");
        });
        return job;
    }

    private audioPath(config: AppConfig, episode: ProcessedBookmark): string {
        const directory = resolve(config.data_dir, "audio");
        const path = resolve(join(directory, episode.filename));
        if (!path.startsWith(directory + "/")) throw new SpotifyRetryError(400, "Invalid audio filename");
        return path;
    }

    private validate(config: AppConfig, episode: ProcessedBookmark, mode: SpotifyRetryJob["mode"]): void {
        const issue = spotifyRetryIssue(config);
        if (issue) throw new SpotifyRetryError(400, issue);
        if (mode === "upload" && !existsSync(this.audioPath(config, episode))) {
            throw new SpotifyRetryError(400, "The saved audio file is missing. Restore it before retrying the Spotify upload.");
        }
    }
}
