import { afterEach, describe, expect, it, vi } from "vitest";
import { listTtsModels } from "../src/tts-catalog.js";

afterEach(() => vi.unstubAllGlobals());

describe("TTS model discovery", () => {
    it("fetches the selected base URL with its dedicated key and returns sorted unique IDs", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "z-custom" }, { id: "gpt-audio-1.5" }, { id: "z-custom" }, {}, { id: 123 }] })));
        vi.stubGlobal("fetch", fetchMock);
        expect(await listTtsModels({ api_base: "https://example.com/proxy/v1///", api_key: "tts-key" })).toEqual(["gpt-audio-1.5", "z-custom"]);
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe("https://example.com/proxy/v1/models");
        expect(options.headers.Authorization).toBe("Bearer tts-key");
        expect(options).not.toHaveProperty("body");
        expect(options.redirect).toBe("error");
    });
    it("supports local keyless services and an empty catalog", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] })));
        vi.stubGlobal("fetch", fetchMock);
        expect(await listTtsModels({ api_base: "http://localhost:8081/v1", api_key: "" })).toEqual([]);
        expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
    });
    it.each([
        { api_base: "", api_key: "" },
        { api_base: "file:///tmp/models", api_key: "" },
        { api_base: "https://example.com/v1?key=secret", api_key: "" },
        { api_base: "https://api.openai.com/v1", api_key: "" },
    ])("rejects invalid connection settings before making a request", async (config) => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        await expect(listTtsModels(config)).rejects.toThrow();
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([401, 403, 404, 429, 500])("reports HTTP %s without exposing the upstream body", async (status) => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream echoed secret-key", { status })));
        const error = await listTtsModels({ api_base: "http://localhost/v1", api_key: "secret-key" }).catch(err => err);
        expect(error.message).toContain(`(${status})`);
        expect(error.message).not.toContain("secret-key");
        expect(error.message).not.toContain("upstream");
    });
    it.each(["bad JSON", JSON.stringify({ models: [] }), "null"])("rejects malformed/unsupported catalogs", async (body) => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
        await expect(listTtsModels({ api_base: "http://localhost/v1", api_key: "" })).rejects.toThrow(/model list/);
    });
    it("reports cancellation separately from a failed provider", async () => {
        vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.reject(new DOMException("Aborted", "AbortError"))));
        await expect(listTtsModels({ api_base: "http://localhost/v1", api_key: "" }, AbortSignal.abort())).rejects.toThrow("cancelled");
    });
});
