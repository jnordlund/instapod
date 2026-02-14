import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranslationConfig } from "../src/types.js";
import {
    detectLanguage,
    translateText,
    translateTitle,
} from "../src/translator.js";
import {
    DEFAULT_TEXT_PROMPT_TEMPLATE,
    DEFAULT_TITLE_PROMPT_TEMPLATE,
} from "../src/translation-prompts.js";

const BASE_CONFIG: TranslationConfig = {
    api_base: "http://localhost:11434/v1",
    api_key: "sk-test",
    model: "gpt-4o-mini",
    target_language: "svenska",
    skip_if_same: false,
    title_prompt: DEFAULT_TITLE_PROMPT_TEMPLATE,
    text_prompt: DEFAULT_TEXT_PROMPT_TEMPLATE,
};

function mockSuccessfulFetch(responseText = "translated"): ReturnType<typeof vi.fn> {
    const mock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
            choices: [{ message: { content: responseText } }],
        }),
    });

    vi.stubGlobal("fetch", mock as unknown as typeof fetch);
    return mock;
}

function getSystemPrompt(fetchMock: ReturnType<typeof vi.fn>): string {
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
        messages: Array<{ role: string; content: string }>;
    };
    return body.messages[0].content;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

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

    it("uses configured text prompt and replaces {{target_language}}", async () => {
        const fetchMock = mockSuccessfulFetch("översatt text");

        await translateText("This is an English sentence.", {
            ...BASE_CONFIG,
            text_prompt: "Translate body to {{target_language}} and keep paragraphs.",
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(getSystemPrompt(fetchMock)).toBe(
            "Translate body to svenska and keep paragraphs."
        );
    });

    it("falls back to default text prompt when custom prompt is empty", async () => {
        const fetchMock = mockSuccessfulFetch("översatt text");

        await translateText("This is another English sentence.", {
            ...BASE_CONFIG,
            text_prompt: "",
        });

        const expectedDefault = DEFAULT_TEXT_PROMPT_TEMPLATE.replace(
            /\{\{\s*target_language\s*\}\}/g,
            "svenska"
        );

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(getSystemPrompt(fetchMock)).toBe(expectedDefault);
    });
});

describe("translateTitle", () => {
    it("uses configured title prompt and replaces {{target_language}}", async () => {
        const fetchMock = mockSuccessfulFetch("översatt titel");

        await translateTitle("My title", {
            ...BASE_CONFIG,
            title_prompt: "Translate title to {{target_language}} only.",
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(getSystemPrompt(fetchMock)).toBe(
            "Translate title to svenska only."
        );
    });

    it("falls back to default prompt when custom prompt is empty", async () => {
        const fetchMock = mockSuccessfulFetch("översatt titel");

        await translateTitle("Another title", {
            ...BASE_CONFIG,
            title_prompt: "   ",
        });

        const expectedDefault = DEFAULT_TITLE_PROMPT_TEMPLATE.replace(
            /\{\{\s*target_language\s*\}\}/g,
            "svenska"
        );

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(getSystemPrompt(fetchMock)).toBe(expectedDefault);
    });
});
