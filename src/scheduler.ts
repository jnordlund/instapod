import cron from "node-cron";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let isRunning = false;

/**
 * Spawn the pipeline as a separate Node process.
 * This keeps all heavy work (translation, TTS) out of the main Express process.
 */
function spawnPipeline(): Promise<void> {
    return new Promise((resolve, reject) => {
        const runner = join(__dirname, "pipeline-runner.js");
        const child = spawn("node", [runner], {
            stdio: "inherit",                        // logs go to parent's stdout/stderr
            env: { ...process.env },                 // inherit env (CONFIG_PATH etc.)
        });

        child.on("error", (err) => {
            reject(new Error(`Pipeline spawn error: ${err.message}`));
        });

        child.on("close", (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Pipeline exited with code ${code}`));
            }
        });
    });
}

/**
 * Start a cron-scheduled task that spawns the pipeline process.
 * Guards against concurrent runs.
 */
export function startScheduler(
    cronExpression: string
): cron.ScheduledTask {
    console.log(`[scheduler] Starting with cron: ${cronExpression}`);

    const task = cron.schedule(cronExpression, async () => {
        if (isRunning) {
            console.log("[scheduler] Previous run still in progress, skipping");
            return;
        }

        isRunning = true;
        console.log(`[scheduler] Starting pipeline run at ${new Date().toISOString()}`);

        try {
            await spawnPipeline();
            console.log(`[scheduler] Pipeline run completed at ${new Date().toISOString()}`);
        } catch (err) {
            console.error("[scheduler] Pipeline run failed:", err);
        } finally {
            isRunning = false;
        }
    });

    return task;
}

/**
 * Manually trigger a pipeline run (used by POST /trigger).
 * Respects the concurrency guard.
 */
export async function triggerManualRun(): Promise<void> {
    if (isRunning) {
        console.log("[trigger] Run already in progress, skipping");
        return;
    }

    isRunning = true;
    console.log(`[trigger] Starting manual pipeline run at ${new Date().toISOString()}`);

    try {
        await spawnPipeline();
        console.log(`[trigger] Manual run completed at ${new Date().toISOString()}`);
    } catch (err) {
        console.error("[trigger] Manual run failed:", err);
    } finally {
        isRunning = false;
    }
}
