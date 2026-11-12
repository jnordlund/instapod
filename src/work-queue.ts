// Pipeline children and Spotify retries share state.json and must not write concurrently.
let tail: Promise<unknown> = Promise.resolve();
let pending = 0;

export function isWorkPending(): boolean {
    return pending > 0;
}

export function enqueueWork<T>(work: () => Promise<T>): Promise<T> {
    pending++;
    const result = tail.then(work).finally(() => { pending--; });
    // A failed job must not prevent subsequent jobs from running.
    tail = result.catch(() => {});
    return result;
}
