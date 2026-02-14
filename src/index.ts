import { loadConfig } from "./config.js";
import { StateManager } from "./state.js";
import { createServer } from "./server.js";
import { startScheduler, triggerManualRun } from "./scheduler.js";

async function main() {
    console.log("🎙️  Instapod starting...");

    // 1. Load config
    const config = loadConfig();
    console.log(`[config] Loaded config for feed: "${config.feed.title}"`);

    // 2. Initialize state (for the server to read — pipeline writes its own)
    const state = new StateManager(config.data_dir);
    console.log(`[state] Data dir: ${config.data_dir}`);

    // 3. Start HTTP server
    const app = createServer(config, state, () => triggerManualRun());

    app.listen(config.server.port, () => {
        console.log(`[server] Listening on port ${config.server.port}`);
        console.log(`[server] Feed URL: ${config.server.base_url}/feed`);
    });

    // 4. Start scheduler (spawns pipeline as child process)
    startScheduler(config.schedule.cron);

    // 5. Run initial pipeline
    console.log("[startup] Running initial pipeline...");
    await triggerManualRun();

    console.log("🎙️  Instapod ready!");
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
