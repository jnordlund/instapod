import { loadConfig } from "./config.js";
import { StateManager } from "./state.js";
import { createServer } from "./server.js";
import { startScheduler, triggerManualRun } from "./scheduler.js";
import { installConsoleLogCapture } from "./logs.js";
import { getOnboardingStatus } from "./onboarding.js";
import type { AppConfig } from "./types.js";

installConsoleLogCapture();

async function main() {
    console.log("🎙️  Instapod starting...");

    // 1. Load config in draft mode so first-run admin can open before setup is complete.
    const config = loadConfig(undefined, { mode: "draft" });
    console.log(`[config] Loaded config for feed: "${config.feed.title}"`);

    // 2. Initialize state (for the server to read — pipeline writes its own)
    const state = new StateManager(config.data_dir);
    console.log(`[state] Data dir: ${config.data_dir}`);

    let schedulerTask: ReturnType<typeof startScheduler> | null = null;
    let schedulerCron: string | null = null;

    const syncScheduler = (nextConfig: AppConfig) => {
        const episodes = state.getProcessedBookmarks();
        const onboarding = getOnboardingStatus(nextConfig, {
            episodeCount: episodes.length,
            lastRun: state.getLastRun(),
        });

        if (!onboarding.runnable) {
            if (schedulerTask) {
                schedulerTask.stop();
                schedulerTask = null;
                schedulerCron = null;
                console.log("[scheduler] Stopped until setup is complete");
            }
            console.log(`[setup] Pipeline disabled: ${onboarding.blockingIssues.join("; ")}`);
            return false;
        }

        if (schedulerTask && schedulerCron === nextConfig.schedule.cron) {
            return true;
        }

        if (schedulerTask) {
            schedulerTask.stop();
        }

        schedulerTask = startScheduler(nextConfig.schedule.cron);
        schedulerCron = nextConfig.schedule.cron;
        return true;
    };

    // 3. Start HTTP server
    const app = createServer(config, state, () => triggerManualRun(), syncScheduler);

    app.listen(config.server.port, () => {
        console.log(`[server] Listening on port ${config.server.port}`);
        console.log(`[server] Feed URL: ${config.server.base_url}/feed`);
    });

    // 4. Start scheduler and initial pipeline only when setup is complete.
    const runnableAtStartup = syncScheduler(config);
    if (runnableAtStartup) {
        console.log("[startup] Running initial pipeline...");
        await triggerManualRun();
    } else {
        console.log("[startup] Skipping initial pipeline until setup is complete");
    }

    console.log("🎙️  Instapod ready!");
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
