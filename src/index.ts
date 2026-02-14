import { loadConfig } from "./config.js";
import { StateManager } from "./state.js";
import { createServer } from "./server.js";
import { startScheduler, triggerManualRun } from "./scheduler.js";
import { runPipeline } from "./worker.js";

async function main() {
    console.log("🎙️  Instapod starting...");

    // 1. Load config
    const config = loadConfig();
    console.log(`[config] Loaded config for feed: "${config.feed.title}"`);

    // 2. Initialize state
    const state = new StateManager(config.data_dir);
    console.log(`[state] Data dir: ${config.data_dir}`);

    // 3. Create a pipeline runner bound to config/state
    const pipeline = () => runPipeline(config, state);

    // 4. Start HTTP server
    const app = createServer(config, state, () => triggerManualRun(pipeline));

    app.listen(config.server.port, () => {
        console.log(`[server] Listening on port ${config.server.port}`);
        console.log(`[server] Feed URL: ${config.server.base_url}/feed`);
    });

    // 5. Start scheduler
    startScheduler(config.schedule.cron, pipeline);

    // 6. Run initial pipeline
    console.log("[startup] Running initial pipeline...");
    try {
        await pipeline();
    } catch (err) {
        console.error("[startup] Initial pipeline run failed:", err);
    }

    console.log("🎙️  Instapod ready!");
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
