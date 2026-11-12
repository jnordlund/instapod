import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueueWork, isWorkPending } from "../src/work-queue.js";
import { triggerManualRun } from "../src/scheduler.js";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

afterEach(() => { vi.resetAllMocks(); });

describe("pipeline and Spotify retry coordination", () => {
    it("holds retries until a pipeline exits and skips overlapping pipeline triggers", async () => {
        const child = new EventEmitter();
        spawnMock.mockReturnValue(child);
        const pipeline = triggerManualRun();
        expect(isWorkPending()).toBe(true);
        let retried = false;
        const retry = enqueueWork(async () => { retried = true; });
        await triggerManualRun();
        expect(spawnMock).toHaveBeenCalledTimes(1);
        expect(retried).toBe(false);
        child.emit("close", 0);
        await pipeline;
        await retry;
        expect(retried).toBe(true);
        expect(isWorkPending()).toBe(false);
    });

    it("releases the queue after a failed pipeline so retries still run", async () => {
        const child = new EventEmitter();
        spawnMock.mockReturnValue(child);
        const pipeline = triggerManualRun();
        let retried = false;
        const retry = enqueueWork(async () => { retried = true; });
        await Promise.resolve();
        child.emit("close", 1);
        await pipeline;
        await retry;
        expect(retried).toBe(true);
        expect(isWorkPending()).toBe(false);
    });
});
