# Configurable TTS providers

Design accepted by the user on 2026-10-31 and implemented on `jncxm/openai-tts`.

## Behavior

- Edge TTS remains the default, including for existing configuration files. Edge voice, rate, and pitch are retained when switching providers.
- The OpenAI / compatible provider has explicit Audio Chat Completions, Speech API, and Realtime modes. Audio Chat is the OpenAI default, initially using `gpt-audio-1.5` and `alloy`; names remain editable. Realtime supports `gpt-realtime-2.1-mini` through GA WebSocket sessions.
- Base URL defaults to `https://api.openai.com/v1`. A dedicated TTS key is masked in the admin API, preserved on masked saves, and never inherited from translation. Local services may omit it.
- Manual model discovery reads `/models` from the current endpoint/key and populates editable suggestions without changing the selected model. Model listing does not prove audio support. Voice suggestions follow the documented Audio Chat/Speech API/Realtime lists, including the smaller `tts-1`/`tts-1-hd` set; custom names remain allowed. Failed/empty lookups preserve manual entry, and source changes cancel stale requests.
- One OpenAI-compatible voice applies across article languages. Optional instructions control delivery; numeric speed applies to Speech API (0.25–4) and Realtime (0.25–1.5).
- Manual voice preview uses unsaved form values and an editable sample of up to 500 characters. It plays privately in the admin page without saving settings, publishing an episode, updating RSS, or uploading to Spotify.
- Audio Chat and Realtime request complete narration in the original language while preserving meaning and allowing the model to choose natural spoken delivery. At the user's explicit request, transcripts are neither required nor compared with the article. Wording differences do not stop generation; incomplete responses and invalid audio still do.
- All modes produce MP3 audio. Realtime receives PCM16 at 24 kHz and encodes it locally with FFmpeg, included in Docker and checked before a session starts.
- Long text is split losslessly into bounded chunks, including overlong sentences and trailing unpunctuated text. Audio Chat and Speech chunks are at most 4,000 characters, below Speech API's 4,096-character limit. Realtime uses at most 1,500 characters in each fresh session, with a five-minute deadline and bounded audio buffers. Cancellation closes the socket and encoder.
- Errors are actionable without upstream response bodies or credentials. There is no automatic retry or provider fallback within an attempt.
- Output is staged outside the published filename and promoted only after worker success. Partial files and preview files are removed on success, failure, or cancellation.
- Configuration is loaded once by each pipeline process. Changes apply to the next run; existing episodes and active runs keep their audio/settings.

## Implementation boundaries

- `tts-config.ts`: provider defaults and readiness validation.
- `config.ts`, `types.ts`, `scheduler.ts`: backward-compatible YAML/types/environment settings and forwarding to scheduled processes.
- `tts-engine.ts`: provider routing, Audio Chat/Speech HTTP contracts, MP3 validation, and Edge narration.
- `tts-realtime.ts`, `tts-ffmpeg.ts`: GA Realtime session lifecycle, complete-response and audio integrity checks, and PCM-to-MP3 encoding.
- `tts-catalog.ts`: model discovery, sanitized lookup errors, and documented voice suggestions.
- `tts-text.ts`, `mp3.ts`: bounded text splitting, narration instructions, MP3 validation, and duration reading.
- `tts.ts`, `tts-worker.ts`: process isolation, structured errors, staging, cancellation, and atomic publication of output.
- `admin.ts`, `onboarding.ts`: conditional configuration, masked-key preservation, private previews, and readiness reporting.

See [ADR 0001](adr/0001-support-separate-openai-audio-contracts.md) for explicit API contracts, [ADR 0002](adr/0002-add-realtime-narration.md) for the subsequent Realtime addition, and [TTS.md](../TTS.md) for operating instructions and environment variables.

## Verification boundary

Latest automated verification ran in an isolated Node 20/FFmpeg container with external networking disabled: `npm run build`; 128 passing tests in 13 files. Valid Audio Chat and Realtime audio is accepted with changed, empty, missing, or null transcripts, including real-worker MP3 generation with differing/missing transcripts. Incomplete responses and corrupt audio still fail, and a later-chunk failure preserves previous output and cleans staging files. The suite also covers GA session configuration, HTTP and event errors, timeouts, cancellation, local empty-key support, lossless chunking, and missing-encoder preflight. Existing Edge, Speech, model-discovery, and authenticated admin-preview tests also pass. Host Node test processes aborted before test startup; container verification completed successfully.

Earlier Realtime UI verification passed 20 Playwright checks, including default Edge selection, third-mode selection, suggested/custom model and voice names, separate speed ranges, model discovery, playable MP3 preview, failure status, cancellation of a stalled session, saving/reloading, and a 390-pixel layout check. The longer Realtime dropdown fits within the mobile form column. Earlier browser verification covered Audio Chat/Speech previews, model-discovery failures/empty catalogs, and stale lookup cancellation.

A separately rebuilt production Docker image passed an isolated Node 20 runtime test with networking disabled after transcript validation was removed: the compiled worker generated a three-chunk MP3 from a local Realtime mock returning differing or missing transcripts. FFmpeg decoded the joined result without errors, the frame-based duration was 1.656 seconds, and no staging files remained. The existing deployed container was not restarted.

Automated verification uses local mock providers, an offline synthetic MP3, and synthetic PCM tones.

A live isolated check on 2026-10-31 used `gpt-realtime-2.1-mini` with `cedar` on one translated Swedish article in seven fresh Realtime sessions. Six chunks matched the source under the strict transcript normalization. The seventh contained two word substitutions and was rejected. One retry of that chunk with identical input matched the source. This reproduces the reported failure type and demonstrates response variation; the exact original failed transcript was not retained and cannot be compared. The check did not publish an episode or modify pipeline state/configuration, and temporary article/transcript copies were removed afterwards. Production retry behavior was not changed.

That live check preceded the user's decision to remove transcript validation. The current implementation accepts the same kind of transcript differences; the regression tests cover the observed substitution pattern with synthetic audio. No additional paid provider calls were needed for this change.

The live check establishes successful API access and complete audio/transcript responses for this configuration at that time. It does not independently verify the spoken audio's fidelity, reliability across other articles, general account permissions, or billing behavior.

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
