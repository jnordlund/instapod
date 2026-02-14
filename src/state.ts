import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { AppState, ProcessedBookmark } from "./types.js";

const EMPTY_STATE: AppState = {
    processedBookmarks: {},
    lastRun: null,
};

export class StateManager {
    private state: AppState;
    private readonly filePath: string;

    constructor(dataDir: string) {
        mkdirSync(dataDir, { recursive: true });
        this.filePath = join(dataDir, "state.json");
        this.state = this.load();
    }

    private load(): AppState {
        try {
            const content = readFileSync(this.filePath, "utf-8");
            return JSON.parse(content) as AppState;
        } catch {
            return { ...EMPTY_STATE, processedBookmarks: {} };
        }
    }

    /** Atomically persist state to disk (write temp → rename). */
    save(): void {
        const tmpPath = this.filePath + ".tmp";
        mkdirSync(dirname(this.filePath), { recursive: true });
        writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), "utf-8");
        renameSync(tmpPath, this.filePath);
    }

    isProcessed(bookmarkId: string): boolean {
        return bookmarkId in this.state.processedBookmarks;
    }

    addProcessed(bookmark: ProcessedBookmark): void {
        this.state.processedBookmarks[bookmark.bookmarkId] = bookmark;
        this.state.lastRun = new Date().toISOString();
        this.save();
    }

    getProcessedBookmarks(): ProcessedBookmark[] {
        // Re-read from disk (pipeline may have written new entries from a child process)
        this.state = this.load();
        return Object.values(this.state.processedBookmarks).sort(
            (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
        );
    }

    getLastRun(): string | null {
        this.state = this.load();
        return this.state.lastRun;
    }

    updateLastRun(): void {
        this.state.lastRun = new Date().toISOString();
        this.save();
    }
}
