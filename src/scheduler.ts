import cron from "node-cron";

let isRunning = false;

/**
 * Start a cron-scheduled task that calls the worker pipeline.
 * Guards against concurrent runs.
 */
export function startScheduler(
    cronExpression: string,
    runPipeline: () => Promise<void>
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
            await runPipeline();
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
export async function triggerManualRun(
    runPipeline: () => Promise<void>
): Promise<void> {
    if (isRunning) {
        console.log("[trigger] Run already in progress, skipping");
        return;
    }

    isRunning = true;
    console.log(`[trigger] Starting manual pipeline run at ${new Date().toISOString()}`);

    try {
        await runPipeline();
        console.log(`[trigger] Manual run completed at ${new Date().toISOString()}`);
    } catch (err) {
        console.error("[trigger] Manual run failed:", err);
    } finally {
        isRunning = false;
    }
}
