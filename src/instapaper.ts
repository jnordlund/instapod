import OAuth from "oauth-1.0a";
import { createHmac } from "node:crypto";
import type {
    InstapaperConfig,
    InstapaperBookmark,
    OAuthToken,
} from "./types.js";

const BASE_URL = "https://www.instapaper.com";

export class InstapaperClient {
    private oauth: OAuth;
    private token: OAuthToken | null = null;
    private config: InstapaperConfig;

    constructor(config: InstapaperConfig) {
        this.config = config;
        this.oauth = new OAuth({
            consumer: {
                key: config.consumer_key,
                secret: config.consumer_secret,
            },
            signature_method: "HMAC-SHA1",
            hash_function(baseString, key) {
                return createHmac("sha1", key).update(baseString).digest("base64");
            },
        });
    }

    /**
     * Authenticate via xAuth to obtain an access token.
     * Instapaper uses xAuth (username/password → OAuth token).
     */
    async authenticate(): Promise<void> {
        if (this.token) return;

        const url = `${BASE_URL}/api/1/oauth/access_token`;
        const data = {
            x_auth_username: this.config.username,
            x_auth_password: this.config.password,
            x_auth_mode: "client_auth",
        };
        const requestData = { url, method: "POST" as const, data };
        const headers = this.oauth.toHeader(this.oauth.authorize(requestData));

        const body = new URLSearchParams(data);

        const response = await fetch(url, {
            method: "POST",
            headers: {
                ...headers,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(`[instapaper] Auth failed (${response.status}):`, text);
            throw new Error("Instapaper authentication failed");
        }

        const responseText = await response.text();
        const params = new URLSearchParams(responseText);

        this.token = {
            token: params.get("oauth_token") ?? "",
            tokenSecret: params.get("oauth_token_secret") ?? "",
        };
    }

    /**
     * Get bookmarks, optionally filtered by folder_id or tag.
     * Note: tag is only used if folder_id is NOT specified.
     */
    async getBookmarks(options?: {
        folderId?: string;
        tag?: string;
    }): Promise<InstapaperBookmark[]> {
        await this.authenticate();

        const url = `${BASE_URL}/api/1/bookmarks/list`;
        const params: Record<string, string> = { limit: "500" };
        if (options?.folderId) {
            params.folder_id = options.folderId;
        } else if (options?.tag) {
            params.tag = options.tag;
        }

        const response = await this.authedRequest(url, params);
        const data = (await response.json()) as Array<
            InstapaperBookmark & { type?: string }
        >;

        // The API returns a mix of types; filter to bookmarks only
        return data.filter((item) => item.type === "bookmark");
    }

    /**
     * Get the full HTML text of a bookmark.
     */
    async getBookmarkText(bookmarkId: string): Promise<string> {
        await this.authenticate();

        const url = `${BASE_URL}/api/1/bookmarks/get_text`;
        const response = await this.authedRequest(url, { bookmark_id: bookmarkId });
        return response.text();
    }

    /**
     * List all folders (used to map tag names → folder IDs).
     */
    async listFolders(): Promise<Array<{ folder_id: number; title: string }>> {
        await this.authenticate();

        const url = `${BASE_URL}/api/1/folders/list`;
        const response = await this.authedRequest(url);
        return response.json() as Promise<
            Array<{ folder_id: number; title: string }>
        >;
    }

    private async authedRequest(
        url: string,
        params?: Record<string, string>
    ): Promise<Response> {
        const requestData = {
            url,
            method: "POST" as const,
            data: params ?? {},
        };
        const tokenData = this.token
            ? { key: this.token.token, secret: this.token.tokenSecret }
            : undefined;

        const headers = this.oauth.toHeader(
            this.oauth.authorize(requestData, tokenData)
        );

        const body = params ? new URLSearchParams(params).toString() : undefined;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                ...headers,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(`[instapaper] API error (${response.status}):`, text);
            throw new Error(`Instapaper API request failed (${response.status})`);
        }

        return response;
    }
}
