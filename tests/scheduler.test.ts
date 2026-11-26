import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueueWork, isWorkPending } from "../src/work-queue.js";
import { ImportRunner } from "../src/scheduler.js";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

afterEach(() => { vi.resetAllMocks(); });

describe("pipeline and Spotify retry coordination", () => {
    it("holds retries until a pipeline exits and skips overlapping pipeline triggers", async () => {
        const child = new EventEmitter();
        spawnMock.mockReturnValue(child);
        const imports = new ImportRunner();
        const pipeline = imports.start();
        expect(imports.status).toBe("queued");
        expect(isWorkPending()).toBe(true);
        let retried = false;
        const retry = enqueueWork(async () => { retried = true; });
        expect(imports.start()).toBeNull();
        await Promise.resolve();
        expect(imports.status).toBe("running");
        expect(spawnMock).toHaveBeenCalledTimes(1);
        expect(retried).toBe(false);
        child.emit("close", 0);
        await pipeline;
        await retry;
        expect(imports.status).toBe("completed");
        expect(retried).toBe(true);
        expect(isWorkPending()).toBe(false);
    });

    it("releases the queue after a failed pipeline so retries still run", async () => {
        const child = new EventEmitter();
        spawnMock.mockReturnValue(child);
        const imports = new ImportRunner();
        const pipeline = imports.start();
        let retried = false;
        const retry = enqueueWork(async () => { retried = true; });
        await Promise.resolve();
        child.emit("close", 1);
        await pipeline;
        await retry;
        expect(imports.status).toBe("failed");
        expect(retried).toBe(true);
        expect(isWorkPending()).toBe(false);
    });

    it("queues one manual import behind Spotify work", async () => {
        let finishRetry!: () => void;
        const retry = enqueueWork(() => new Promise<void>(resolve => { finishRetry = resolve; }));
        let ran = false;
        const imports = new ImportRunner(async () => { ran = true; });
        const pipeline = imports.start();
        await Promise.resolve();

        expect(imports.status).toBe("queued");
        expect(imports.start()).toBeNull();
        expect(ran).toBe(false);
        finishRetry();
        await retry;
        await pipeline;
        expect(imports.status).toBe("completed");
        expect(ran).toBe(true);
    });
});
