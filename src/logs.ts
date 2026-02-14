import { format } from "node:util";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
    id: number;
    timestamp: string;
    level: LogLevel;
    source: string;
    message: string;
}

const MAX_LOG_ENTRIES = 2000;
const DEFAULT_LIMIT = 200;

const entries: LogEntry[] = [];
let nextId = 1;
let captureInstalled = false;

export function addLog(level: LogLevel, message: string, source = "app"): void {
    entries.push({
        id: nextId++,
        timestamp: new Date().toISOString(),
        level,
        source,
        message,
    });

    if (entries.length > MAX_LOG_ENTRIES) {
        entries.splice(0, entries.length - MAX_LOG_ENTRIES);
    }
}

export function getLogs(options?: { limit?: number; sinceId?: number }): LogEntry[] {
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const sinceId = options?.sinceId;

    const filtered = sinceId === undefined
        ? entries
        : entries.filter((entry) => entry.id > sinceId);

    if (filtered.length <= limit) {
        return [...filtered];
    }

    return filtered.slice(filtered.length - limit);
}

export function installConsoleLogCapture(): void {
    if (captureInstalled) return;
    captureInstalled = true;

    const original = {
        log: console.log.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
    };

    console.log = ((...args: unknown[]) => {
        addLog("info", format(...args), "app");
        original.log(...args);
    }) as typeof console.log;

    console.info = ((...args: unknown[]) => {
        addLog("info", format(...args), "app");
        original.info(...args);
    }) as typeof console.info;

    console.warn = ((...args: unknown[]) => {
        addLog("warn", format(...args), "app");
        original.warn(...args);
    }) as typeof console.warn;

    console.error = ((...args: unknown[]) => {
        addLog("error", format(...args), "app");
        original.error(...args);
    }) as typeof console.error;
}
