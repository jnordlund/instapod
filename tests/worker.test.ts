import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { InstapaperClient } from "../src/instapaper.js";
import { StateManager } from "../src/state.js";
import { synthesize } from "../src/tts.js";
import { runPipeline } from "../src/worker.js";

vi.mock("../src/tts.js", async importOriginal => ({
    ...await importOriginal<typeof import("../src/tts.js")>(),
    synthesize: vi.fn(),
}));

afterEach(() => {
    vi.restoreAllMocks();
});

it("reports a failed import while keeping successfully processed episodes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "instapod-worker-test-"));
    try {
        const configPath = join(dir, "config.yaml");
        writeFileSync(configPath, "{}");
        const config = loadConfig(configPath, { mode: "draft" });
        config.data_dir = dir;
        config.filters.tags = [];
        config.translation.api_key = "";
        delete config.spotify_upload;
        const state = new StateManager(dir);
        vi.spyOn(InstapaperClient.prototype, "getBookmarks").mockResolvedValue(
            [1, 2].map(id => ({
                bookmark_id: id, title: `Article ${id}`, url: "https://example.test",
                description: "", hash: "", type: "bookmark",
            }))
        );
        vi.spyOn(InstapaperClient.prototype, "getBookmarkText").mockResolvedValue("<p>Sample article.</p>");
        vi.mocked(synthesize).mockRejectedValueOnce(new Error("TTS unavailable")).mockResolvedValueOnce(15);

        await expect(runPipeline(config, state)).rejects.toThrow("Could not import 1 of 2 bookmarks");
        expect(state.getProcessedBookmarks().map(episode => episode.bookmarkId)).toEqual(["2"]);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
