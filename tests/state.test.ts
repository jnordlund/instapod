import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StateManager } from "../src/state.js";

describe("StateManager", () => {
    let tempDir: string;

    afterEach(() => {
        if (tempDir) {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    function createManager(): StateManager {
        tempDir = mkdtempSync(join(tmpdir(), "instapod-test-"));
        return new StateManager(tempDir);
    }

    it("starts with empty state", () => {
        const state = createManager();
        expect(state.getProcessedBookmarks()).toEqual([]);
        expect(state.getLastRun()).toBeNull();
    });

    it("tracks processed bookmarks", () => {
        const state = createManager();

        state.addProcessed({
            bookmarkId: "123",
            title: "Test",
            source: "example.com",
            filename: "123-test.mp3",
            duration: 60,
            pubDate: "2026-01-15T10:00:00Z",
        });

        expect(state.isProcessed("123")).toBe(true);
        expect(state.isProcessed("456")).toBe(false);
        expect(state.getProcessedBookmarks()).toHaveLength(1);
    });

    it("persists state across instances", () => {
        const state1 = createManager();
        const savedDir = tempDir; // Save before createManager creates new one

        state1.addProcessed({
            bookmarkId: "123",
            title: "Test",
            source: "example.com",
            filename: "123-test.mp3",
            duration: 60,
            pubDate: "2026-01-15T10:00:00Z",
        });

        // Create new instance pointing to same dir
        const state2 = new StateManager(savedDir);
        expect(state2.isProcessed("123")).toBe(true);
        expect(state2.getProcessedBookmarks()).toHaveLength(1);
    });

    it("sorts episodes by pubDate (newest first)", () => {
        const state = createManager();

        state.addProcessed({
            bookmarkId: "1",
            title: "Old",
            source: "a.com",
            filename: "1.mp3",
            duration: 30,
            pubDate: "2026-01-01T00:00:00Z",
        });

        state.addProcessed({
            bookmarkId: "2",
            title: "New",
            source: "b.com",
            filename: "2.mp3",
            duration: 60,
            pubDate: "2026-02-01T00:00:00Z",
        });

        const episodes = state.getProcessedBookmarks();
        expect(episodes[0].title).toBe("New");
        expect(episodes[1].title).toBe("Old");
    });

    it("updates lastRun timestamp", () => {
        const state = createManager();
        expect(state.getLastRun()).toBeNull();

        state.updateLastRun();
        expect(state.getLastRun()).not.toBeNull();
    });
});
