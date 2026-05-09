import { existsSync } from "node:fs";
import { join } from "node:path";

export function resolveNodeScriptCommand(
    directory: string,
    jsFilename: string
): { command: string; args: string[] } {
    const jsPath = join(directory, jsFilename);
    if (existsSync(jsPath)) {
        return { command: process.execPath, args: [jsPath] };
    }

    const tsPath = jsPath.replace(/\.js$/, ".ts");
    if (existsSync(tsPath)) {
        return { command: process.execPath, args: ["--import", "tsx", tsPath] };
    }

    return { command: process.execPath, args: [jsPath] };
}
