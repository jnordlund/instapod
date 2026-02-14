import { describe, it, expect } from "vitest";
import { generateFeed } from "../src/feed.js";
import type { AppConfig, ProcessedBookmark } from "../src/types.js";

const mockConfig: AppConfig = {
    instapaper: {
        consumer_key: "",
        consumer_secret: "",
        username: "",
        password: "",
    },
    filters: { tags: [] },
    translation: {
        api_base: "",
        api_key: "",
        model: "",
        target_language: "svenska",
        skip_if_same: true,
        title_prompt: "",
        text_prompt: "",
    },
    tts: { voice: "sv-SE-SofieNeural", rate: "+0%", pitch: "+0Hz" },
    schedule: { cron: "*/30 * * * *" },
    server: { port: 8080, base_url: "https://pod.example.com" },
    feed: {
        title: "Test Feed",
        description: "A test feed",
        language: "sv",
        author: "Tester",
    },
    data_dir: "/tmp/instapod-test",
};

const mockEpisodes: ProcessedBookmark[] = [
    {
        bookmarkId: "1001",
        title: "First Article",
        source: "example.com",
        filename: "1001-first-article.mp3",
        duration: 125,
        pubDate: "2026-01-15T10:00:00Z",
    },
    {
        bookmarkId: "1002",
        title: "Second Article",
        source: "blog.dev",
        filename: "1002-second-article.mp3",
        duration: 340,
        pubDate: "2026-01-16T12:00:00Z",
    },
];

describe("generateFeed", () => {
    it("generates valid RSS XML", () => {
        const xml = generateFeed(mockConfig, mockEpisodes);

        expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
        expect(xml).toContain('<rss version="2.0"');
        expect(xml).toContain("xmlns:itunes=");
    });

    it("includes channel metadata", () => {
        const xml = generateFeed(mockConfig, mockEpisodes);

        expect(xml).toContain("<title>Test Feed</title>");
        expect(xml).toContain("<description>A test feed</description>");
        expect(xml).toContain("<language>sv</language>");
    });

    it("includes episode items with enclosures", () => {
        const xml = generateFeed(mockConfig, mockEpisodes);

        expect(xml).toContain("<title>First Article</title>");
        expect(xml).toContain("<title>Second Article</title>");
        expect(xml).toContain(
            'url="https://pod.example.com/audio/1001-first-article.mp3"'
        );
        expect(xml).toContain('type="audio/mpeg"');
    });

    it("formats duration correctly", () => {
        const xml = generateFeed(mockConfig, mockEpisodes);

        // 125s = 2:05
        expect(xml).toContain("<itunes:duration>2:05</itunes:duration>");
        // 340s = 5:40
        expect(xml).toContain("<itunes:duration>5:40</itunes:duration>");
    });

    it("escapes XML special characters", () => {
        const episodes: ProcessedBookmark[] = [
            {
                bookmarkId: "999",
                title: 'Article with "quotes" & <tags>',
                source: "site.com",
                filename: "999-test.mp3",
                duration: 60,
                pubDate: "2026-01-15T10:00:00Z",
            },
        ];

        const xml = generateFeed(mockConfig, episodes);

        expect(xml).toContain("&amp;");
        expect(xml).toContain("&lt;");
        expect(xml).toContain("&gt;");
        expect(xml).toContain("&quot;");
    });

    it("handles empty episodes list", () => {
        const xml = generateFeed(mockConfig, []);

        expect(xml).toContain("<channel>");
        expect(xml).not.toContain("<item>");
    });
});
