# Configurable TTS providers

Design accepted by the user on 2026-10-31 and implemented on `jncxm/openai-tts`.

## Behavior

- Edge TTS remains the default, including for existing configuration files. Edge voice, rate, and pitch are retained when switching providers.
- The OpenAI / compatible provider has explicit Audio Chat Completions, Speech API, and Realtime modes. Audio Chat is the OpenAI default, initially using `gpt-audio-1.5` and `alloy`; names remain editable. Realtime supports `gpt-realtime-2.1-mini` through GA WebSocket sessions.
- Base URL defaults to `https://api.openai.com/v1`. A dedicated TTS key is masked in the admin API, preserved on masked saves, and never inherited from translation. Local services may omit it.
- Manual model discovery reads `/models` from the current endpoint/key and populates editable suggestions without changing the selected model. Model listing does not prove audio support. Voice suggestions follow the documented Audio Chat/Speech API/Realtime lists, including the smaller `tts-1`/`tts-1-hd` set; custom names remain allowed. Failed/empty lookups preserve manual entry, and source changes cancel stale requests.
- One OpenAI-compatible voice applies across article languages. Optional instructions control delivery; numeric speed applies to Speech API (0.25–4) and Realtime (0.25–1.5).
- Manual voice preview uses unsaved form values and an editable sample of up to 500 characters. It plays privately in the admin page without saving settings, publishing an episode, updating RSS, or uploading to Spotify.
- Audio Chat and Realtime request verbatim narration and check the returned transcript after normalizing punctuation, whitespace, and case. Missing/changed transcripts or incomplete output stop generation. This check can reject correct spoken renditions such as numbers transcribed as words; it is not independent verification of the actual audio.
- Speech API has no returned transcript and therefore has no text comparison. All modes produce MP3 audio. Realtime receives PCM16 at 24 kHz and encodes it locally with FFmpeg, included in Docker and checked before a session starts.
- Long text is split losslessly into bounded chunks, including overlong sentences and trailing unpunctuated text. Audio Chat and Speech chunks are at most 4,000 characters, below Speech API's 4,096-character limit. Realtime uses at most 1,500 characters in each fresh session, with a five-minute deadline and bounded audio buffers. Cancellation closes the socket and encoder.
- Errors are actionable without upstream response bodies or credentials. There is no automatic retry or provider fallback within an attempt.
- Output is staged outside the published filename and promoted only after worker success. Partial files and preview files are removed on success, failure, or cancellation.
- Configuration is loaded once by each pipeline process. Changes apply to the next run; existing episodes and active runs keep their audio/settings.

## Implementation boundaries

- `tts-config.ts`: provider defaults and readiness validation.
- `config.ts`, `types.ts`, `scheduler.ts`: backward-compatible YAML/types/environment settings and forwarding to scheduled processes.
- `tts-engine.ts`: provider routing, Audio Chat/Speech HTTP contracts, strict transcript checking, and Edge narration.
- `tts-realtime.ts`, `tts-ffmpeg.ts`: GA Realtime session lifecycle, complete-response and transcript validation, and PCM-to-MP3 encoding.
- `tts-catalog.ts`: model discovery, sanitized lookup errors, and documented voice suggestions.
- `tts-text.ts`, `mp3.ts`: bounded text splitting, transcript normalization, MP3 validation, and duration reading.
- `tts.ts`, `tts-worker.ts`: process isolation, structured errors, staging, cancellation, and atomic publication of output.
- `admin.ts`, `onboarding.ts`: conditional configuration, masked-key preservation, private previews, and readiness reporting.

See [ADR 0001](adr/0001-support-separate-openai-audio-contracts.md) for explicit API contracts, [ADR 0002](adr/0002-add-realtime-narration.md) for the subsequent Realtime addition, and [TTS.md](../TTS.md) for operating instructions and environment variables.

## Verification boundary

Verified: `npm run build`; 127 passing tests in 13 files. The Realtime tests exercise GA session configuration, HTTP and event errors, changed/missing transcripts, incomplete/corrupt streams, timeouts, cancellation, local empty-key support, lossless chunking through the real worker and encoder, staged-file cleanup, and missing-encoder preflight. Existing Edge, Audio Chat, Speech, model-discovery, and authenticated admin-preview tests also pass.

Realtime UI verification passed 20 Playwright checks, including default Edge selection, third-mode selection, suggested/custom model and voice names, separate speed ranges, model discovery, playable MP3 preview, failure status, cancellation of a stalled session, saving/reloading, and a 390-pixel layout check. The longer Realtime dropdown fits within the mobile form column. Earlier browser verification covered Audio Chat/Speech previews, model-discovery failures/empty catalogs, and stale lookup cancellation.

A separately built Docker image passed an isolated Node 20 runtime test with networking disabled: the actual worker generated a three-chunk MP3 from a local Realtime mock, FFmpeg decoded the joined result without errors, the frame-based duration was 1.656 seconds, and no staging files remained. The existing deployed container was not restarted.

Automated verification uses local mock providers, an offline synthetic MP3, and synthetic PCM tones. Real OpenAI narration quality, account permissions, and billing require a real-provider check and have not been verified by these tests.

## Official references checked on 2026-10-31

- [OpenAI Audio Chat Completions](https://developers.openai.com/api/docs/guides/audio-chat-completions)
- [OpenAI GPT-Audio-1.5](https://developers.openai.com/api/docs/models/gpt-audio-1.5)
- [OpenAI Create speech](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)
- [OpenAI Deprecations](https://developers.openai.com/api/docs/deprecations)
- [GPT-Realtime-2.1 Mini](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini)
- [Realtime client events](https://developers.openai.com/api/reference/resources/realtime/client-events)
- [Realtime server events](https://developers.openai.com/api/reference/resources/realtime/server-events)
- [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations)

OpenAI schedules `tts-1`, `tts-1-hd`, and `gpt-4o-mini-tts` for shutdown on 2027-01-06. `gpt-audio-1.5` uses Audio Chat mode, not `/audio/speech`; compatible services have their own lifecycle.
