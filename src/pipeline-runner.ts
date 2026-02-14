/**
 * pipeline-runner.ts — Standalone script that runs the full pipeline once.
 * Spawned as a child process by the main server to avoid blocking Express.
 *
 * Reads config from CONFIG_PATH env, runs the pipeline, then exits.
 */
import { loadConfig } from "./config.js";
import { StateManager } from "./state.js";
import { runPipeline } from "./worker.js";

async function main() {
    const config = loadConfig();
    const state = new StateManager(config.data_dir);

    await runPipeline(config, state);
}

main()
    .then(() => {
        process.exit(0);
    })
    .catch((err) => {
        console.error("[pipeline-runner] Fatal:", err);
        process.exit(1);
    });
