import { describe, it, expect } from "vitest";
import { parseArticle } from "../src/parser.js";

describe("parseArticle", () => {
    it("converts HTML to plain text", () => {
        const result = parseArticle(
            "123",
            "Test Title",
            "https://example.com/article",
            "<p>Hello <strong>world</strong>. This is a test.</p>"
        );

        expect(result.body).toContain("Hello world");
        expect(result.body).toContain("This is a test");
    });

    it("builds intro with source domain", () => {
        const result = parseArticle(
            "123",
            "My Article",
            "https://www.example.com/path",
            "<p>Body text</p>"
        );

        expect(result.introText).toBe("En artikel från example.com. My Article.");
        expect(result.source).toBe("example.com");
    });

    it("builds intro without source when empty", () => {
        const result = parseArticle("123", "My Article", "", "<p>Body</p>");

        expect(result.introText).toBe("My Article.");
        expect(result.source).toBe("");
    });

    it("handles empty HTML", () => {
        const result = parseArticle("123", "Title", "source", "");

        expect(result.body).toBe("");
        expect(result.fullText).toContain("Title");
    });

    it("strips www. from source URLs", () => {
        const result = parseArticle(
            "123",
            "T",
            "https://www.nytimes.com/article",
            "<p>x</p>"
        );

        expect(result.source).toBe("nytimes.com");
    });

    it("combines intro and body in fullText", () => {
        const result = parseArticle(
            "123",
            "Title",
            "https://example.com",
            "<p>Body here</p>"
        );

        expect(result.fullText).toMatch(
            /^En artikel från example\.com\. Title\.\n\nBody here$/
        );
    });
});
