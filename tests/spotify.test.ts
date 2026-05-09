import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/types.js";
import {
    cancelSpotifyHeadlessAuth,
    getSpotifyStatus,
    installSaveToSpotify,
    startSpotifyHeadlessAuth,
    uploadEpisodeToSpotify,
} from "../src/spotify.js";

const { spawnMock } = vi.hoisted(() => ({
    spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
    spawn: spawnMock,
}));

class FakeChildProcess extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    stdin = {
        write: vi.fn(),
        end: vi.fn(),
    };
    kill = vi.fn();
}

const BASE_CONFIG: AppConfig = {
    instapaper: {
        consumer_key: "",
        consumer_secret: "",
        username: "",
        password: "",
    },
    filters: { tags: [] },
    translation: {
        api_base: "",
        api_key: "",
        model: "",
        target_language: "svenska",
        skip_if_same: true,
        title_prompt: "",
        text_prompt: "",
    },
    tts: { voice: "sv-SE-SofieNeural", rate: "+0%", pitch: "+0Hz" },
    spotify_upload: {
        enabled: true,
        cli_path: "save-to-spotify",
        language: "sv",
        wait_for_ready: false,
    },
    schedule: { cron: "*/30 * * * *" },
    server: { port: 8080, base_url: "https://pod.example.com" },
    feed: {
        title: "Test Feed",
        description: "A test feed",
        language: "sv",
        author: "Tester",
    },
    data_dir: "/tmp/instapod-test",
};

afterEach(() => {
    cancelSpotifyHeadlessAuth();
    delete process.env.INSTAPOD_ALLOW_UNVERIFIED_SPOTIFY_INSTALL;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    spawnMock.mockReset();
});

describe("spotify integration helpers", () => {
    it("parses JSON status output that is surrounded by extra text", async () => {
        spawnMock
            .mockImplementationOnce(() => {
                const child = new FakeChildProcess();
                queueMicrotask(() => {
                    child.stdout.emit("data", "1.2.3\n");
                    child.emit("close", 0);
                });
                return child as never;
            })
            .mockImplementationOnce(() => {
                const child = new FakeChildProcess();
                queueMicrotask(() => {
                    child.stdout.emit(
                        "data",
                        'prefix {"authenticated":true,"token_valid":true} suffix\n'
                    );
                    child.emit("close", 0);
                });
                return child as never;
            });

        const status = await getSpotifyStatus(BASE_CONFIG);
        expect(status.installed).toBe(true);
        expect(status.authenticated).toBe(true);
        expect(status.version).toBe("1.2.3");
    });

    it("extracts the Spotify auth URL from login command output", async () => {
        spawnMock.mockImplementationOnce(() => {
            const child = new FakeChildProcess();
            queueMicrotask(() => {
                child.stdout.emit(
                    "data",
                    "Open this URL: https://accounts.spotify.com/authorize?client_id=test\n"
                );
            });
            return child as never;
        });

        const result = await startSpotifyHeadlessAuth(BASE_CONFIG);
        expect(result.ok).toBe(true);
        expect(result.authUrl).toBe(
            "https://accounts.spotify.com/authorize?client_id=test"
        );
    });

    it("throws a normalized error when upload command fails", async () => {
        spawnMock.mockImplementationOnce(() => {
            const child = new FakeChildProcess();
            queueMicrotask(() => {
                child.stderr.emit("data", "boom");
                child.emit("close", 1);
            });
            return child as never;
        });

        await expect(
            uploadEpisodeToSpotify(BASE_CONFIG, {
                filePath: "/tmp/audio.mp3",
                title: "Example",
                source: "example.com",
            })
        ).rejects.toThrow("save-to-spotify upload failed: boom");
    });

    it("returns upload metadata when upload command succeeds", async () => {
        spawnMock.mockImplementationOnce(() => {
            const child = new FakeChildProcess();
            queueMicrotask(() => {
                child.stdout.emit(
                    "data",
                    '{"episode_id":"ep_123","episode_uri":"spotify:episode:ep_123","show_id":"show_9"}'
                );
                child.emit("close", 0);
            });
            return child as never;
        });

        const state = await uploadEpisodeToSpotify(BASE_CONFIG, {
            filePath: "/tmp/audio.mp3",
            title: "Example",
            source: "example.com",
        });

        expect(state.episodeId).toBe("ep_123");
        expect(state.episodeUri).toBe("spotify:episode:ep_123");
        expect(state.showId).toBe("show_9");
        expect(state.uploadedAt).toBeTruthy();
    });

    it("blocks installer script execution unless explicitly allowed", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

        const result = await installSaveToSpotify(BASE_CONFIG);

        expect(result.ok).toBe(false);
        expect(result.error).toContain(
            "Automatic CLI install is disabled by default for security."
        );
        expect(fetchMock).not.toHaveBeenCalled();
        expect(spawnMock).not.toHaveBeenCalled();
    });
});
