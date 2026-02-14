# PRD: Instapod Service

**Status:** Draft
**Datum:** 2026-02-14
**Författare:** Jonas Nordlund

---

## Problem Statement

Att läsa alla sparade artiklar tar tid och kräver fokus framför en skärm. Många artiklar hamnar i Instapaper-kön och blir aldrig lästa. Genom att automatiskt omvandla artiklarna till podcastavsnitt kan man konsumera dem under pendling, promenader eller hushållsarbete — utan att ändra sina vanor kring hur man sparar artiklar.

## Mål

1. **Automatisk omvandling** — Nya artiklar i Instapaper omvandlas till mp3 utan manuell hantering
2. **Standard podcast-feed** — Avsnitten publiceras som en giltig RSS/XML-feed som fungerar i valfri podcastapp (Apple Podcasts, Overcast, Pocket Casts etc.)
3. **Filtrering via taggar** — Användaren väljer vilka Instapaper-taggar som ska generera avsnitt, så att inte all sparad läsning blir ljud
4. **Översättning till talspråk** — Artiklar på främmande språk översätts automatiskt till det konfigurerade talspråket via ett OpenAI-kompatibelt API innan TTS
5. **Lätt att drifta** — Tjänsten körs som en enda Docker-container utan externa beroenden utöver Instapaper API och LLM-API

## Icke-mål

- **Inget webbgränssnitt** — Konfiguration sker via config-fil och miljövariabler. En UI kan läggas till senare men ingår inte i v1.
- **Ingen flerspråkig röst per artikel** — Alla artiklar översätts till talspråket och läses med en och samma röst. Automatisk röstbyte per källspråk är en framtida förbättring.
- **Ingen transkribering/synkning** — Inga chapter markers eller synkad text med ljudet.
- **Ingen användarhantering** — Tjänsten är single-tenant, en Instapaper-användare per instans.
- **Ingen extern lagring** — Mp3-filer lagras lokalt på en Docker-volym. S3-stöd kan läggas till senare.

---

## User Stories

### Som lyssnare

- **Prenumerera på feeden** — Som lyssnare vill jag lägga till en RSS-URL i min podcastapp så att nya avsnitt dyker upp automatiskt.
- **Höra källan** — Som lyssnare vill jag att varje avsnitt börjar med en kort intro som berättar var artikeln kommer ifrån och vad den heter, så att jag vet vad jag lyssnar på.
- **Lyssna på alla språk** — Som lyssnare vill jag kunna lyssna på artiklar oavsett originalspråk, översatta till svenska (eller mitt konfigurerade språk), så att jag slipper växla mentalt mellan språk.
- **Filtrera innehåll** — Som lyssnare vill jag kunna välja att bara artiklar med specifika taggar (t.ex. "tech", "longread") blir avsnitt, så att feeden inte fylls med allt jag sparar.

### Som operatör

- **Enkel deploy** — Som operatör vill jag starta tjänsten med `docker run` och en config-fil, utan att konfigurera databaser eller externa tjänster.
- **Manuell trigger** — Som operatör vill jag kunna trigga en omvandling manuellt (utöver schemat), t.ex. när jag just sparat en artikel jag vill lyssna på direkt.
- **Byta röst** — Som operatör vill jag kunna ställa in TTS-röst och språk i config-filen.

---

## Krav

### P0 — Must-have

| # | Krav | Acceptanskriterier |
|---|------|--------------------|
| 1 | **Instapaper-integration** | Hämtar artiklar via Instapaper Full API (OAuth). Stödjer filtrering på alla artiklar, en specifik tagg, eller flera taggar. |
| 2 | **Artikelextraktion** | Extraherar title, author/source och brödtext från Instapaper-artikeln. Hanterar HTML → ren text. |
| 3 | **Översättning via LLM** | Översätter artikeltext (inkl. titel) till det konfigurerade talspråket via ett OpenAI-kompatibelt chat completions API (`/v1/chat/completions`). Konfigurerbar API-adress (default: OpenAI), modell (default: en modern billig modell, t.ex. `gpt-4o-mini`), och API-nyckel. Artiklar som redan är på talspråket skickas inte till översättning. |
| 4 | **TTS med edge-tts** | Omvandlar översatt text till mp3 via edge-tts. Konfigurerbar röst (voice name). Default: svensk röst. |
| 5 | **Kort intro per avsnitt** | Varje avsnitt inleds med t.ex. *"En artikel från [källa]. [Titel]."* innan brödtexten läses upp. |
| 6 | **RSS/XML podcast-feed** | Genererar en valid podcast RSS 2.0 feed med iTunes-namespace. Inkluderar title, description, enclosure (mp3-url), pubDate, duration per avsnitt. |
| 7 | **HTTP-server** | Serverar RSS-feeden och mp3-filerna över HTTP. Publik, ingen autentisering. |
| 8 | **Schemalagd körning** | Kollar efter nya artiklar med konfigurerbart intervall (cron-uttryck eller minuter). |
| 9 | **Manuell trigger** | Exponerar ett HTTP-endpoint (t.ex. `POST /trigger`) för att starta en körning on-demand. |
| 10 | **Deduplicering** | Håller koll på vilka artiklar som redan konverterats (via bookmark_id) så att samma artikel inte konverteras igen. |
| 11 | **Docker-container** | Levereras som Dockerfile. Alla filer (mp3, state, config) kan monteras som volymer. |
| 12 | **Config-fil** | YAML eller JSON-konfiguration för: Instapaper-credentials, LLM API-inställningar, taggar att filtrera på, TTS-röst/språk, cron-schema, HTTP-port, feed-metadata (podcast-titel, beskrivning). |

### P1 — Nice-to-have

| # | Krav | Acceptanskriterier |
|---|------|--------------------|
| 13 | **Hastighet/pitch-kontroll** | Konfigurerbar talhastighet och pitch via edge-tts parametrar. |
| 14 | **Max-längd per avsnitt** | Möjlighet att dela långa artiklar i flera delar (del 1, del 2 etc.) med konfigurerbar maxlängd. |
| 15 | **Healthcheck-endpoint** | `GET /health` returnerar status och senaste körning. |
| 16 | **Loggning** | Strukturerad loggning (JSON) med konfigurerbar nivå. |
| 17 | **Podcast-artwork** | Stöd för att konfigurera en cover-bild för feeden (iTunes:image). |
| 18 | **Översättningscache** | Cacha översatta texter för att undvika onödiga API-anrop vid omkörning. |

### P2 — Framtida förbättringar

| # | Krav |
|---|------|
| 19 | Automatisk språkdetektering per artikel med röstbyte |
| 20 | Webb-UI för konfiguration och status |
| 21 | S3-kompatibel lagring (R2, MinIO) |
| 22 | Chapter markers baserat på rubriker i artikeln |
| 23 | Stöd för andra artikelkällor (Pocket, Readwise, RSS) |
| 24 | Notifieringar vid fel (webhook, e-post) |
| 25 | Valfri LLM-sammanfattning som intro istället för ren översättning |

---

## Arkitektur (översikt)

```
┌──────────────────────────────────────────────────────────┐
│  Docker Container                                        │
│                                                          │
│  ┌───────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │ Scheduler │──▶│   Worker     │──▶│ OpenAI-compat  │  │
│  │ (cron)    │   │              │   │ LLM API        │  │
│  └───────────┘   │ 1. Fetch     │   │ (översättning) │  │
│                  │ 2. Parse     │   └───────┬────────┘  │
│  ┌───────────┐   │ 3. Translate │           │ text      │
│  │ HTTP API  │   │ 4. TTS      │           ▼            │
│  │           │   │ 5. RSS      │   ┌──────────────┐     │
│  │ GET /feed │   └──────────────┘   │  edge-tts    │     │
│  │ GET /audio│                      └──────┬───────┘     │
│  │ POST /trig│                             │ mp3         │
│  └───────────┘                             ▼             │
│       │                            ┌──────────────┐      │
│       │◀───────────────────────────│  /data        │      │
│       │                            │  ├─ audio/   │      │
│       │                            │  ├─ feed.xml │      │
│       │                            │  └─ state    │      │
│       │                            └──────────────┘      │
│       │                             (Docker vol)         │
└───────┼──────────────────────────────────────────────────┘
        ▼
  Podcast-app (RSS)
```

## Tech Stack

| Komponent | Val | Motivering |
|-----------|-----|------------|
| Språk | Node.js / TypeScript | Enligt preferens |
| Översättning | OpenAI-kompatibelt API (`/v1/chat/completions`) | Konfigurerbar endpoint — fungerar med OpenAI, lokala modeller (Ollama, vLLM), eller andra kompatibla API:er |
| Default-modell | `gpt-4o-mini` (eller likvärdig billig modell) | Bra kvalitet till låg kostnad för översättning |
| TTS | edge-tts (via CLI eller node-wrapper) | Gratis, bra kvalitet, många röster/språk |
| HTTP | Express eller Fastify | Lättviktigt, serverar feed + filer + trigger |
| Instapaper | Instapaper Full API (OAuth 1.0a) | Ger tillgång till bokmärken, taggar och text |
| RSS | Generera XML manuellt eller med bibliotek (podcast-feed, rss) | Måste följa podcast RSS 2.0 + iTunes spec |
| State | JSON-fil på disk | Enkelt, inga databaser. Sparar lista av processade bookmark_id:n |
| Container | Docker (node:20-slim + edge-tts) | Allt i en image |

---

## Config-exempel

```yaml
# config.yaml
instapaper:
  consumer_key: "..."
  consumer_secret: "..."
  username: "..."
  password: "..."

filters:
  tags: ["tech", "longread"]  # tom lista = alla artiklar

translation:
  api_base: "https://api.openai.com/v1"  # byt till egen URL för lokalt/alternativt API
  api_key: "sk-..."
  model: "gpt-4o-mini"
  target_language: "svenska"  # språk att översätta till
  skip_if_same: true          # hoppa över översättning om artikeln redan är på target_language

tts:
  voice: "sv-SE-SofieNeural"
  rate: "+0%"
  pitch: "+0Hz"

schedule:
  cron: "*/30 * * * *"  # var 30:e minut

server:
  port: 8080
  base_url: "https://pod.example.com"  # extern URL för enclosure-länkar

feed:
  title: "Mina Artiklar"
  description: "Artiklar från Instapaper, upplästa"
  language: "sv"
  author: "Jonas"

data_dir: "/data"
```

---

## Framgångsmått

| Mått | Mål | Typ |
|------|-----|-----|
| Andel artiklar som konverteras utan fel | > 95% | Ledande |
| Tid från sparad artikel till tillgängligt avsnitt (schemalagt) | < 35 min | Ledande |
| Feed validerar i podcast-appar | Fungerar i minst 3 appar | Ledande |
| Antal artiklar konsumerade via ljud per vecka | Ökning vs olästa artiklar i kön | Eftersläpande |

---

## Öppna frågor

| Fråga | Vem |
|-------|-----|
| Instapapers Full API kräver godkännande — har du redan API-access, eller behöver vi ansöka? | Jonas |
| Ska artiklar markeras som lästa/arkiverade i Instapaper efter konvertering? | Jonas |
| Max artikellängd som edge-tts hanterar bra i ett svep — behöver vi chunka långa artiklar redan i v1? | Engineering |
| Vilken edge-tts röst funkar bäst för svenska? Behövs en utvärdering av tillgängliga röster? | Jonas |
| Hur ska base_url hanteras — reverse proxy, Cloudflare tunnel, eller direkt exponering? | Jonas / Infra |
| Hur ska språkdetektering fungera — LLM-baserat, bibliotek (franc/cld), eller Instapaper-metadata? | Engineering |
| Ska översättningen skicka hela artikeln i ett anrop eller chunka den? Token-gränser varierar per modell. | Engineering |
| Uppskattad kostnad per artikel för översättning med gpt-4o-mini? Behövs en budget-varning? | Jonas |
