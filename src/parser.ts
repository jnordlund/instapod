import { convert } from "html-to-text";
import type { ParsedArticle } from "./types.js";

const HTML_TO_TEXT_OPTIONS = {
    wordwrap: false as false,
    preserveNewlines: true,
    selectors: [
        { selector: "a", options: { ignoreHref: true } },
        { selector: "img", format: "skip" },
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" },
    ],
};

/**
 * Convert HTML article body to clean plain-text and build
 * a short intro sentence for TTS.
 */
export function parseArticle(
    bookmarkId: string,
    title: string,
    source: string,
    html: string
): ParsedArticle {
    const body = convert(html, HTML_TO_TEXT_OPTIONS).trim();

    const sourceName = cleanSource(source);
    const introText = sourceName
        ? `En artikel från ${sourceName}. ${title}.`
        : `${title}.`;

    const fullText = `${introText}\n\n${body}`;

    return { bookmarkId, title, source: sourceName, body, introText, fullText };
}

/**
 * Best-effort extraction of a human-readable source name from a URL or string.
 */
function cleanSource(source: string): string {
    if (!source) return "";
    try {
        const url = new URL(source);
        // Remove www. prefix
        return url.hostname.replace(/^www\./, "");
    } catch {
        // Not a URL, return as-is
        return source;
    }
}
