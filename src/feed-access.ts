import type { AppConfig } from "./types.js";

export const FEED_ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function trimBaseUrl(config: AppConfig): string {
    return config.server.base_url.replace(/\/$/, "");
}

function isTokenAccessEnabled(config: AppConfig): boolean {
    return Boolean(config.feed_access?.enabled);
}

export function getFeedPath(config: AppConfig): string {
    if (!isTokenAccessEnabled(config)) {
        return "/feed";
    }
    return `/${config.feed_access.token}/feed`;
}

export function getAudioPath(config: AppConfig, filename: string): string {
    const encodedFilename = encodeURIComponent(filename);
    if (!isTokenAccessEnabled(config)) {
        return `/audio/${encodedFilename}`;
    }
    return `/${config.feed_access.token}/audio/${encodedFilename}`;
}

export function getFeedUrl(config: AppConfig): string {
    return `${trimBaseUrl(config)}${getFeedPath(config)}`;
}

export function getAudioUrl(config: AppConfig, filename: string): string {
    return `${trimBaseUrl(config)}${getAudioPath(config, filename)}`;
}

export function isFeedAccessToken(value: string): boolean {
    return FEED_ACCESS_TOKEN_PATTERN.test(value);
}

export function isFeedAccessAllowed(config: AppConfig, token: string): boolean {
    return isTokenAccessEnabled(config) && token === config.feed_access.token;
}

export function isFeedAccessEnabled(config: AppConfig): boolean {
    return isTokenAccessEnabled(config);
}
