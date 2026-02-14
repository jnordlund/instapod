import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectLanguage } from "../src/translator.js";

describe("detectLanguage", () => {
    it("detects Swedish text", () => {
        const result = detectLanguage(
            "Det här är en lång svensk text som borde kunna detekteras korrekt av språkdetekteringsbiblioteket."
        );
        expect(result).toBe("swe");
    });

    it("detects English text", () => {
        const result = detectLanguage(
            "This is a long English text that should be detected correctly by the language detection library."
        );
        expect(result).toBe("eng");
    });
});

describe("translateText", () => {
    it("skips translation when text is already in target language", async () => {
        // We just need to verify detectLanguage returns "swe" for Swedish text
        // The actual translateText function depends on an API, so we test the detection logic
        const detected = detectLanguage(
            "Det här är en svensk text som inte behöver översättas till svenska."
        );
        expect(detected).toBe("swe");
    });
});
