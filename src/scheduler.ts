import cron from "node-cron";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { addLog } from "./logs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let isRunning = false;

/**
 * Build a restricted set of environment variables for the child process.
 * Only forwards variables the pipeline actually needs, avoiding leakage
 * of sensitive vars like NODE_OPTIONS, AWS credentials, tokens, etc.
 */
function buildChildEnv(): Record<string, string | undefined> {
    const allowed = [
        // Node.js essentials
        "PATH", "HOME", "NODE_ENV", "TZ",
        // App config
        "CONFIG_PATH",
        // Config env overrides (see config.ts applyEnvOverrides)
        "INSTAPAPER_CONSUMER_KEY", "INSTAPAPER_CONSUMER_SECRET",
        "INSTAPAPER_USERNAME", "INSTAPAPER_PASSWORD",
        "TRANSLATION_API_BASE", "TRANSLATION_API_KEY",
        "TRANSLATION_MODEL", "TRANSLATION_TARGET_LANGUAGE",
        "TTS_VOICE",
        "SERVER_PORT", "SERVER_BASE_URL",
        "DATA_DIR",
    ];

    const env: Record<string, string | undefined> = {};
    for (const key of allowed) {
        if (process.env[key] !== undefined) {
            env[key] = process.env[key];
        }
    }
    return env;
}

/**
 * Spawn the pipeline as a separate Node process.
 * This keeps all heavy work (translation, TTS) out of the main Express process.
 */
function spawnPipeline(): Promise<void> {
    return new Promise((resolve, reject) => {
        const runner = join(__dirname, "pipeline-runner.js");
        const child = spawn("node", [runner], {
            stdio: ["ignore", "pipe", "pipe"],      // capture child logs for admin log view
            env: buildChildEnv(),
        });

        const attachStream = (
            stream: NodeJS.ReadableStream | null,
            write: (chunk: string) => void,
            source: string,
            level: "info" | "error"
        ) => {
            if (!stream) return;
            let buffer = "";

            stream.on("data", (chunk: Buffer | string) => {
                const text = typeof chunk === "string"
                    ? chunk
                    : chunk.toString("utf-8");

                write(text);
                buffer += text;

                let newlineIndex = buffer.indexOf("\n");
                while (newlineIndex >= 0) {
                    const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
                    if (line.trim().length > 0) {
                        addLog(level, line, source);
                    }
                    buffer = buffer.slice(newlineIndex + 1);
                    newlineIndex = buffer.indexOf("\n");
                }
            });

            stream.on("end", () => {
                const line = buffer.replace(/\r$/, "").trim();
                if (line.length > 0) {
                    addLog(level, line, source);
                }
            });
        };

        attachStream(
            child.stdout,
            (chunk) => process.stdout.write(chunk),
            "pipeline",
            "info"
        );
        attachStream(
            child.stderr,
            (chunk) => process.stderr.write(chunk),
            "pipeline",
            "error"
        );

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
