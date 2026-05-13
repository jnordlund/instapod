import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/types.js";
import {
    cancelSpotifyHeadlessAuth,
    createSpotifyShow,
    getSpotifyStatus,
    installSaveToSpotify,
    listSpotifyShows,
    startSpotifyHeadlessAuth,
    updateSaveToSpotify,
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
            })
            .mockImplementationOnce(() => {
                const child = new FakeChildProcess();
                queueMicrotask(() => {
                    child.stdout.emit(
                        "data",
                        '{"latest_version":"1.2.3","update_available":false}'
                    );
                    child.emit("close", 0);
                });
                return child as never;
            });

        const status = await getSpotifyStatus(BASE_CONFIG);
        expect(status.installed).toBe(true);
        expect(status.authenticated).toBe(true);
        expect(status.version).toBe("1.2.3");
        expect(status.latestVersion).toBe("1.2.3");
        expect(status.updateAvailable).toBe(false);
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

    it("uses a configured show ID instead of creating a new show on upload", async () => {
        spawnMock.mockImplementationOnce(() => {
            const child = new FakeChildProcess();
            queueMicrotask(() => {
                child.stdout.emit(
                    "data",
                    '{"episode_id":"ep_123","episode_uri":"spotify:episode:ep_123"}'
                );
                child.emit("close", 0);
            });
            return child as never;
        });

        const config: AppConfig = {
            ...BASE_CONFIG,
            spotify_upload: {
                ...BASE_CONFIG.spotify_upload!,
                show_id: "spotify:show:fixed",
                show_title: "Instapod jnordlund",
                new_show: "Instapod jnordlund",
            },
        };

        const state = await uploadEpisodeToSpotify(config, {
            filePath: "/tmp/audio.mp3",
            title: "Example",
            source: "example.com",
        });

        const args = spawnMock.mock.calls[0][1] as string[];
        expect(args).toContain("--show-id");
        expect(args).toContain("spotify:show:fixed");
        expect(args).not.toContain("--new-show");
        expect(state.showId).toBe("spotify:show:fixed");
    });

    it("lists Spotify shows from JSON output", async () => {
        spawnMock.mockImplementationOnce(() => {
            const child = new FakeChildProcess();
            queueMicrotask(() => {
                child.stdout.emit(
                    "data",
                    '{"shows":[{"id":"spotify:show:abc","title":"Instapod jnordlund","created_at":"2026-05-11T09:10:53.308Z"}]}'
                );
                child.emit("close", 0);
            });
            return child as never;
        });

        const result = await listSpotifyShows(BASE_CONFIG);

        expect(result.ok).toBe(true);
        expect(result.shows).toEqual([
            {
                id: "spotify:show:abc",
                title: "Instapod jnordlund",
                createdAt: "2026-05-11T09:10:53.308Z",
            },
        ]);
        expect(spawnMock).toHaveBeenCalledWith(
            "save-to-spotify",
            ["--json", "shows"],
            expect.any(Object)
        );
    });

    it("lists Spotify shows from table output when JSON is unavailable", async () => {
        spawnMock.mockImplementationOnce(() => {
            const child = new FakeChildProcess();
            queueMicrotask(() => {
                child.stdout.emit(
                    "data",
                    "Shows:\n\n  spotify:show:033eMc8xp6AvWjHzJ3T81m       Instapod jnordlund    2026-05-11T09:10:53.308Z\n"
                );
                child.emit("close", 0);
            });
            return child as never;
        });

        const result = await listSpotifyShows(BASE_CONFIG);

        expect(result.ok).toBe(true);
        expect(result.shows).toEqual([
            {
                id: "spotify:show:033eMc8xp6AvWjHzJ3T81m",
                title: "Instapod jnordlund",
                createdAt: "2026-05-11T09:10:53.308Z",
            },
        ]);
    });

    it("creates a Spotify show and returns its fixed ID", async () => {
        spawnMock.mockImplementationOnce(() => {
            const child = new FakeChildProcess();
            queueMicrotask(() => {
                child.stdout.emit(
                    "data",
                    '{"show":{"id":"spotify:show:new","title":"Instapod jnordlund"}}'
                );
                child.emit("close", 0);
            });
            return child as never;
        });

        const result = await createSpotifyShow(BASE_CONFIG, {
            title: "Instapod jnordlund",
        });

        expect(result.ok).toBe(true);
        expect(result.show).toEqual({
            id: "spotify:show:new",
            title: "Instapod jnordlund",
        });
        expect(spawnMock).toHaveBeenCalledWith(
            "save-to-spotify",
            [
                "--json",
                "shows",
                "create",
                "--title",
                "Instapod jnordlund",
                "--summary",
                "A test feed",
                "--language",
                "sv",
            ],
            expect.any(Object)
        );
    });

    it("runs the installer script from the admin install flow", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            text: async () => "# installer",
        });
        vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
        const child = new FakeChildProcess();
        spawnMock.mockImplementationOnce(() => {
            queueMicrotask(() => {
                child.stdout.emit("data", "installed\n");
                child.emit("close", 0);
            });
            return child as never;
        });

        const result = await installSaveToSpotify(BASE_CONFIG);

        expect(result.ok).toBe(false);
        expect(result.error).toContain(
            "Installer completed, but /tmp/instapod-test/bin/save-to-spotify was not created."
        );
        expect(fetchMock).toHaveBeenCalledWith(
            "https://saveto.spotify.com/install.sh",
            expect.any(Object)
        );
        expect(spawnMock).toHaveBeenCalledWith(
            "bash",
            ["-s", "--", "--dir", "/tmp/instapod-test/bin", "--no-skills"],
            expect.any(Object)
        );
        expect(child.stdin.write).toHaveBeenCalledWith("# installer");
    });

    it("updates the installed CLI with the native update command", async () => {
        spawnMock.mockImplementationOnce(() => {
            const child = new FakeChildProcess();
            queueMicrotask(() => {
                child.stdout.emit("data", "updated\n");
                child.emit("close", 0);
            });
            return child as never;
        });

        const result = await updateSaveToSpotify(BASE_CONFIG);

        expect(result.ok).toBe(true);
        expect(result.stdout).toBe("updated\n");
        expect(spawnMock).toHaveBeenCalledWith(
            "save-to-spotify",
            ["update"],
            expect.any(Object)
        );
    });
});
