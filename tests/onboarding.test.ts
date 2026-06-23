import { describe, expect, it } from "vitest";
import { getOnboardingStatus, isRunnableConfig } from "../src/onboarding.js";
import type { AppConfig } from "../src/types.js";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
    const config: AppConfig = {
        instapaper: {
            consumer_key: "ck",
            consumer_secret: "cs",
            username: "user",
            password: "pass",
        },
        filters: { tags: ["pod"] },
        translation: {
            api_base: "https://api.openai.com/v1",
            api_key: "sk-test",
            model: "gpt-4o-mini",
            target_language: "svenska",
            skip_if_same: true,
            title_prompt: "",
            text_prompt: "",
        },
        tts: {
            voice: "sv-SE-SofieNeural",
            rate: "+0%",
            pitch: "+0Hz",
        },
        spotify_upload: {
            enabled: false,
            cli_path: "save-to-spotify",
            language: "sv",
            wait_for_ready: false,
        },
        schedule: { cron: "*/30 * * * *" },
        server: {
            port: 8080,
            base_url: "https://pod.example.com",
        },
        feed: {
            title: "Test Feed",
            description: "A test feed",
            language: "sv",
            author: "Tester",
        },
        admin: {
            password: "secret",
            session_secret: "0123456789abcdef0123456789abcdef",
            allowed_cidrs: [],
        },
        data_dir: "/tmp/instapod-test",
    };

    return {
        ...config,
        ...overrides,
        instapaper: { ...config.instapaper, ...overrides.instapaper },
        translation: { ...config.translation, ...overrides.translation },
        server: { ...config.server, ...overrides.server },
        feed: { ...config.feed, ...overrides.feed },
        admin: { ...config.admin, ...overrides.admin },
    };
}

describe("onboarding status", () => {
    it("marks complete core setup as runnable", () => {
        const status = getOnboardingStatus(makeConfig(), {
            episodeCount: 0,
            lastRun: null,
        });

        expect(status.runnable).toBe(true);
        expect(status.feedUrl).toBe("https://pod.example.com/feed");
        expect(status.steps.find((step) => step.id === "first_run")?.status).toBe("missing");
        expect(isRunnableConfig(makeConfig())).toBe(true);
    });

    it("reports missing core config as blockers", () => {
        const status = getOnboardingStatus(
            makeConfig({
                instapaper: { consumer_key: "" } as AppConfig["instapaper"],
                translation: { api_key: "" } as AppConfig["translation"],
                server: { base_url: "" } as AppConfig["server"],
            }),
            { episodeCount: 0, lastRun: null }
        );

        expect(status.runnable).toBe(false);
        expect(status.blockingIssues.join(" ")).toContain("instapaper.consumer_key");
        expect(status.blockingIssues.join(" ")).toContain("translation.api_key");
        expect(status.steps.find((step) => step.id === "instapaper")?.status).toBe("missing");
        expect(status.steps.find((step) => step.id === "first_run")?.status).toBe("blocked");
    });
});
