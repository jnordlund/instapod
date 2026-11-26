import type { NextFunction, Response } from "express";

export function sendAudio(
    res: Response,
    next: NextFunction,
    audioDir: string,
    filename: string
): void {
    if (!/^[a-zA-Z0-9_-]+\.mp3$/.test(filename)) {
        res.status(400).json({ error: "Invalid filename" });
        return;
    }

    res.sendFile(filename, { root: audioDir }, (err) => {
        if (!err || res.destroyed) return;
        if (res.headersSent) next(err);
        else if ("status" in err && err.status === 416) res.status(416).end();
        else res.status(404).json({ error: "Audio file not found" });
    });
}
