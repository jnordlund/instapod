// ── Shared types for Instapod ──

export interface InstapaperConfig {
    consumer_key: string;
    consumer_secret: string;
    username: string;
    password: string;
}

export interface FilterConfig {
    tags: string[];
}

export interface TranslationConfig {
    api_base: string;
    api_key: string;
    model: string;
    target_language: string;
    skip_if_same: boolean;
}

export interface TtsConfig {
    voice: string;
    rate: string;
    pitch: string;
}

export interface ScheduleConfig {
    cron: string;
}

export interface ServerConfig {
    port: number;
    base_url: string;
}

export interface FeedConfig {
    title: string;
    description: string;
    language: string;
    author: string;
    image?: string;
}

export interface AppConfig {
    instapaper: InstapaperConfig;
    filters: FilterConfig;
    translation: TranslationConfig;
    tts: TtsConfig;
    schedule: ScheduleConfig;
    server: ServerConfig;
    feed: FeedConfig;
    data_dir: string;
}

// ── Article types ──

export interface ParsedArticle {
    bookmarkId: string;
    title: string;
    source: string;
    body: string;
    introText: string;
    fullText: string; // intro + body combined for TTS
}

// ── State types ──

export interface ProcessedBookmark {
    bookmarkId: string;
    title: string;
    source: string;
    filename: string;
    duration: number; // seconds
    pubDate: string;  // ISO 8601
}

export interface AppState {
    processedBookmarks: Record<string, ProcessedBookmark>;
    lastRun: string | null; // ISO 8601
}

// ── Instapaper API types ──

export interface InstapaperBookmark {
    bookmark_id: number;
    title: string;
    url: string;
    description: string;
    hash: string;
    type: string;
}

export interface InstapaperFolder {
    folder_id: number;
    title: string;
    slug: string;
}

export interface OAuthToken {
    token: string;
    tokenSecret: string;
}
