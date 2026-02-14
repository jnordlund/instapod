import type { AppConfig, ProcessedBookmark } from "./types.js";

/**
 * Generate a valid RSS 2.0 podcast feed XML with iTunes namespace.
 */
export function generateFeed(
    config: AppConfig,
    episodes: ProcessedBookmark[]
): string {
    const baseUrl = config.server.base_url.replace(/\/$/, "");

    const items = episodes
        .map((ep) => {
            const audioUrl = `${baseUrl}/audio/${encodeURIComponent(ep.filename)}`;
            const durationFormatted = formatDuration(ep.duration);

            return `    <item>
      <title>${escapeXml(ep.title)}</title>
      <description>${escapeXml(`Artikel från ${ep.source}`)}</description>
      <enclosure url="${escapeXml(audioUrl)}" type="audio/mpeg" />
      <guid isPermaLink="false">${escapeXml(ep.bookmarkId)}</guid>
      <pubDate>${new Date(ep.pubDate).toUTCString()}</pubDate>
      <itunes:author>${escapeXml(config.feed.author)}</itunes:author>
      <itunes:duration>${durationFormatted}</itunes:duration>
      <itunes:explicit>no</itunes:explicit>
    </item>`;
        })
        .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(config.feed.title)}</title>
    <link>${escapeXml(baseUrl)}</link>
    <description>${escapeXml(config.feed.description)}</description>
    <language>${escapeXml(config.feed.language)}</language>
    <atom:link href="${escapeXml(baseUrl)}/feed" rel="self" type="application/rss+xml" />
    <itunes:author>${escapeXml(config.feed.author)}</itunes:author>
    <itunes:summary>${escapeXml(config.feed.description)}</itunes:summary>
    <itunes:explicit>no</itunes:explicit>
    <itunes:category text="Technology" />
${items}
  </channel>
</rss>`;
}

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
        return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${m}:${String(s).padStart(2, "0")}`;
}

function escapeXml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
