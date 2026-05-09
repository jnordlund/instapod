# 🎙️ Instapod

Convert your [Instapaper](https://www.instapaper.com/) articles into a personal podcast feed — automatically fetched, translated, read aloud via text-to-speech, and optionally uploaded to Spotify.

## How it works

```
Instapaper → Fetch articles → Translate (LLM) → Text-to-Speech → RSS Feed
                                                              ↘ Spotify Upload
```

1. **Fetch** — Pulls saved articles from Instapaper, filtered by tag
2. **Translate** — Translates article text via any OpenAI-compatible API
3. **Synthesize** — Converts translated text to speech using Microsoft Edge TTS
4. **Serve** — Hosts an RSS podcast feed you can subscribe to in any podcast app
5. **Upload** — Optionally saves new episodes to Spotify via `save-to-spotify`

## Quick start

### 1. Configure

```bash
cp config.example.yaml config.yaml
# Edit config.yaml with your credentials
```

### 2. Run with Docker (recommended)

```bash
docker compose up --build -d
```

The feed is available at `http://localhost:8080/feed`.

### 3. Run locally

```bash
npm install
npm run dev
```

### 4. Optional: enable Spotify upload

Open `http://localhost:8080/admin`, go to **Configuration → Spotify Upload**, then:

1. Click **Install CLI** or confirm the detected `save-to-spotify` path
2. Click **Authenticate** and open the Spotify authorization link
3. Paste the redirect URL back into the admin UI and complete auth
4. Enable **Upload new episodes to Spotify** and save the configuration

Newly processed episodes will then be uploaded with Spotify's `save-to-spotify` CLI.

## Using with Instapaper

Instapod uses **tags** to decide which articles to convert. The workflow:

1. Save an article to Instapaper (via browser extension, app, or email)
2. Tag the article with your configured tag (e.g. `pod`)
3. Instapod picks it up on the next scheduled run, translates it, and generates an audio episode

Configure which tags to watch in `config.yaml`:

```yaml
filters:
  tags: ["pod"]  # Articles tagged "pod" become episodes
```

- Use **one or more tags** — articles matching any tag are included
- Set `tags: []` to process **all** saved articles (not recommended for large libraries)
- Articles are only processed once; re-tagging a processed article won't regenerate it

> **Tip:** Create a dedicated tag like `podd` or `listen` so you can selectively choose which articles become podcast episodes.

## Exposing to the internet

The feed must be reachable from the internet for podcast apps to fetch it. A few options:

### Reverse proxy (recommended)

Use Nginx, Caddy, Traefik etc to proxy requests to Instapod:

```nginx
# Nginx example
server {
    listen 443 ssl;
    server_name pod.example.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
    }
}
```

Set `base_url` in `config.yaml` to your public URL:

```yaml
server:
  base_url: "https://pod.example.com"
```

> **Important:** `base_url` must match the public URL — it's used to generate audio file links in the RSS feed.

### Cloudflare Tunnel

```bash
cloudflared tunnel --url http://localhost:8080
```


## Subscribing with a podcast app

Once the feed is accessible, add it to your podcast app as a custom RSS feed:

| App | How to add |
|---|---|
| **Apple Podcasts** | Library → ⋯ → Follow a Show by URL → paste feed URL |
| **Overcast** | Add Podcast → Add URL → paste feed URL |
| **Pocket Casts** | Search → "Submit RSS" → paste feed URL |
| **Spotify** | Supported via `save-to-spotify` upload; enable Spotify Upload in Admin |
| **AntennaPod** | + Add Podcast → RSS feed URL → paste feed URL |
| **Google Podcasts** | Add by RSS feed → paste feed URL |

Your feed URL is: `https://<your-domain>/feed`

New episodes appear automatically as Instapod processes tagged articles.

## Configuration

See [`config.example.yaml`](config.example.yaml) for all options:

| Section | Key | Description |
|---|---|---|
| `instapaper` | `consumer_key`, `consumer_secret`, `username`, `password` | Instapaper API credentials |
| `filters` | `tags` | Only process articles with these tags (empty = all) |
| `translation` | `api_base`, `api_key`, `model` | OpenAI-compatible translation API |
| `translation` | `target_language`, `skip_if_same`, `title_prompt`, `text_prompt` | Target language, language-skip, and translation prompt templates |
| `tts` | `voice`, `rate`, `pitch` | Edge TTS voice settings |
| `spotify_upload` | `enabled`, `cli_path`, `show_id`, `new_show`, `language`, `summary`, `image_path`, `wait_for_ready` | Optional upload to Spotify via `save-to-spotify` |
| `schedule` | `cron` | How often to check for new articles |
| `server` | `port`, `base_url` | HTTP server port and public URL for feed links |
| `feed` | `title`, `description`, `author`, `image` | Podcast feed metadata |
| `data_dir` | — | Where audio files and state are stored |

### Available TTS voices

Any [Microsoft Edge TTS voice](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support) works. Some Swedish examples:

- `sv-SE-SofieNeural` (female)
- `sv-SE-MattiasNeural` (male)

### Translation API

Instapod translates articles using any **OpenAI-compatible** chat completions API (`/v1/chat/completions`). This means you can use:

| Provider | `api_base` | Notes |
|---|---|---|
| **OpenAI** | `https://api.openai.com/v1` | Official API, requires API key |
| **Azure OpenAI** | `https://<resource>.openai.azure.com/openai/deployments/<model>/v1` | Enterprise |
| **Ollama** | `http://localhost:11434/v1` | Free, local, runs on your hardware |
| **LM Studio** | `http://localhost:1234/v1` | Local with GUI |
| **Any proxy** | Varies | Anything that speaks the OpenAI protocol |

```yaml
translation:
  api_base: "http://localhost:11434/v1"  # Point to your API
  api_key: "sk-..."                       # API key (or dummy for local)
  model: "gpt-4o-mini"                    # Model name as the API expects it
  target_language: "svenska"
  skip_if_same: true                      # Skip translation if already in target language
  title_prompt: "You are a translator. Translate the following title to {{target_language}}. Return only the translated title, nothing else."
  text_prompt: "You are a translator. Translate the following text to {{target_language}}. Preserve paragraph breaks. Return only the translated text, nothing else."
```

`{{target_language}}` is replaced with the current `target_language` value before sending prompts to the API.

> **Self-hosting tip:** If you want to proxy your existing ChatGPT, Claude, or Gemini subscriptions as an OpenAI-compatible API, check out [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI). It wraps multiple AI providers behind a single `/v1/chat/completions` endpoint with OAuth support and load balancing.

### Spotify upload

Instapod supports Spotify by uploading generated MP3 episodes through Spotify's [`save-to-spotify`](https://github.com/spotify/save-to-spotify) CLI. This is separate from the RSS feed path because Spotify does not support subscribing to arbitrary private RSS feeds in the same way podcast apps do.

Short setup:

1. Open `/admin`
2. Install `save-to-spotify` manually (recommended), or set `INSTAPOD_ALLOW_UNVERIFIED_SPOTIFY_INSTALL=1` and use **Install CLI**
3. Use **Authenticate** and complete the browser login flow
4. Enable **Upload new episodes to Spotify**
5. Set `show_id` or `new_show`, then save the configuration

Headless auth uses:

```bash
save-to-spotify auth login --no-browser
```

The admin UI shows the authorization URL and accepts the redirect URL that the CLI asks for. After the first login, `save-to-spotify` stores and refreshes its token automatically. Instapod stores that config under `data_dir/config` unless `XDG_CONFIG_HOME` is already set. For fully non-interactive auth, set `SAVE_TO_SPOTIFY_AUTH_TOKEN`.

```yaml
spotify_upload:
  enabled: true
  cli_path: "/data/bin/save-to-spotify"
  show_id: "spotify:show:..."
  language: "sv"
  summary: "Artikel från {{source}}"
  wait_for_ready: false
```

If `show_id` is empty, you can set `new_show` to create/use a named show. If both are empty, the CLI uses its most recent show or creates one.

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/feed` | RSS podcast feed (XML) |
| `GET` | `/audio/:filename` | Stream an episode MP3 |
| `POST` | `/trigger` | Manually trigger a pipeline run |
| `GET` | `/health` | Health check with episode count |
| `POST` | `/api/spotify/install` | Install `save-to-spotify` from the admin UI (requires `INSTAPOD_ALLOW_UNVERIFIED_SPOTIFY_INSTALL=1`) |
| `POST` | `/api/spotify/auth/start` | Start headless Spotify auth |
| `POST` | `/api/spotify/auth/complete` | Complete headless Spotify auth |

## Architecture

```
index.ts          → Express server + scheduler
scheduler.ts      → Spawns pipeline as child process (cron)
pipeline-runner.ts → Standalone pipeline script
worker.ts         → Fetch → parse → translate → TTS → optional Spotify upload → save state
spotify.ts        → save-to-spotify install/auth/upload wrapper
tts.ts            → Spawns TTS in child process
tts-worker.ts     → Edge TTS synthesis (runs isolated)
translator.ts     → OpenAI-compatible translation with retry
feed.ts           → RSS/iTunes XML generation
state.ts          → JSON state persistence
config.ts         → YAML config loader
```

The pipeline runs in a **separate Node.js process** to keep the Express server responsive during long translation and TTS operations.

## Tech stack

- **Runtime**: Node.js 20
- **Language**: TypeScript
- **TTS**: Microsoft Edge TTS (`@andresaya/edge-tts`)
- **Translation**: Any OpenAI-compatible chat completions API
- **Server**: Express
- **Scheduling**: node-cron
- **Auth**: OAuth 1.0a (Instapaper API)
- **Spotify upload**: Spotify `save-to-spotify` CLI
- **Containerization**: Docker (multi-stage build)

## License

MIT
