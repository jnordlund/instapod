import { ConfigValidationError, validateConfig } from "./config.js";
import type {
    AppConfig,
    OnboardingStatus,
    OnboardingStep,
    OnboardingStepStatus,
} from "./types.js";
import { getFeedUrl } from "./feed-access.js";

interface OnboardingStateSnapshot {
    episodeCount: number;
    lastRun: string | null;
}

function hasText(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function allText(values: unknown[]): boolean {
    return values.every(hasText);
}

function step(
    id: OnboardingStep["id"],
    label: string,
    status: OnboardingStepStatus,
    required: boolean,
    detail: string,
    action?: string
): OnboardingStep {
    return { id, label, status, required, detail, action };
}

export function getRunnableConfigIssues(config: AppConfig): string[] {
    try {
        validateConfig(config, { mode: "runnable" });
        return [];
    } catch (err) {
        if (err instanceof ConfigValidationError) {
            return err.issues;
        }
        return [(err as Error).message || "Configuration is not runnable"];
    }
}

export function isRunnableConfig(config: AppConfig): boolean {
    return getRunnableConfigIssues(config).length === 0;
}

export function getOnboardingStatus(
    config: AppConfig,
    state: OnboardingStateSnapshot
): OnboardingStatus {
    const blockingIssues = getRunnableConfigIssues(config);
    const runnable = blockingIssues.length === 0;
    const instapaperReady = allText([
        config.instapaper.consumer_key,
        config.instapaper.consumer_secret,
        config.instapaper.username,
        config.instapaper.password,
    ]);
    const translationReady = allText([
        config.translation.api_base,
        config.translation.api_key,
        config.translation.model,
        config.translation.target_language,
    ]);
    const feedReady = allText([
        config.server.base_url,
        config.feed.title,
        config.feed.description,
        config.feed.language,
        config.feed.author,
    ]);
    const firstRunComplete = Boolean(state.lastRun) || state.episodeCount > 0;

    const steps: OnboardingStep[] = [
        step(
            "admin",
            "Admin password",
            config.admin?.password ? "complete" : "missing",
            true,
            config.admin?.password
                ? "Admin access is protected."
                : "Set the admin password before configuring the app.",
            "Set password"
        ),
        step(
            "instapaper",
            "Connect Instapaper",
            instapaperReady ? "complete" : "missing",
            true,
            instapaperReady
                ? "Instapaper credentials are present."
                : "Add username, password, consumer key, and consumer secret.",
            "Add Instapaper credentials"
        ),
        step(
            "translation",
            "Configure translation",
            translationReady ? "complete" : "missing",
            true,
            translationReady
                ? "Translation API settings are present."
                : "Add an OpenAI-compatible API base, API key, model, and target language.",
            "Add translation settings"
        ),
        step(
            "feed",
            "Publish feed metadata",
            feedReady ? "complete" : "missing",
            true,
            feedReady
                ? `Podcast feed will be served at ${getFeedUrl(config)}.`
                : "Add the public base URL and feed metadata.",
            "Add feed settings"
        ),
        step(
            "first_run",
            "Run the first import",
            firstRunComplete ? "complete" : runnable ? "missing" : "blocked",
            false,
            firstRunComplete
                ? "At least one pipeline run has completed."
                : runnable
                    ? "Configuration is ready. Run the pipeline once to create the first episode."
                    : "Complete the required setup before running the pipeline.",
            "Run now"
        ),
        step(
            "spotify_optional",
            "Spotify upload",
            config.spotify_upload?.enabled ? "complete" : "optional",
            false,
            config.spotify_upload?.enabled
                ? "Spotify upload is enabled."
                : "Optional. RSS works without Spotify upload.",
            "Configure Spotify later"
        ),
    ];

    return {
        runnable,
        blockingIssues,
        steps,
        feedUrl: feedReady ? getFeedUrl(config) : null,
        firstRunComplete,
        episodeCount: state.episodeCount,
        lastRun: state.lastRun,
    };
}
