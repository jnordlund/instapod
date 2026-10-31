# Configurable TTS providers

Design accepted by the user on 2026-10-31 and implemented on `jncxm/openai-tts`.

## Behavior

- Edge TTS remains the default, including for existing configuration files. Edge voice, rate, and pitch are retained when switching providers.
- The OpenAI / compatible provider has explicit Audio Chat Completions and Speech API modes. Audio Chat is the OpenAI default, initially using `gpt-audio-1.5` and `alloy`; names remain editable.
- Base URL defaults to `https://api.openai.com/v1`. A dedicated TTS key is masked in the admin API, preserved on masked saves, and never inherited from translation. Local services may omit it.
- One OpenAI-compatible voice applies across article languages. Optional instructions control delivery; numeric speed applies only to Speech API.
- Manual voice preview uses unsaved form values and an editable sample of up to 500 characters. It plays privately in the admin page without saving settings, publishing an episode, updating RSS, or uploading to Spotify.
- Audio Chat requests verbatim narration and checks the returned transcript after normalizing punctuation, whitespace, and case. Missing/changed transcripts or incomplete output stop generation. This check can reject correct spoken renditions such as numbers transcribed as words; it is not independent verification of the actual audio.
- Speech API has no returned transcript and therefore has no text comparison. Both modes require MP3 audio.
- Long text is split losslessly into bounded chunks, including overlong sentences and trailing unpunctuated text. OpenAI chunks are at most 4,000 characters, below Speech API's 4,096-character limit.
- Errors are actionable without upstream response bodies or credentials. There is no automatic retry or provider fallback within an attempt.
- Output is staged outside the published filename and promoted only after worker success. Partial files and preview files are removed on success, failure, or cancellation.
- Configuration is loaded once by each pipeline process. Changes apply to the next run; existing episodes and active runs keep their audio/settings.

## Implementation boundaries

- `tts-config.ts`: provider defaults and readiness validation.
- `config.ts`, `types.ts`, `scheduler.ts`: backward-compatible YAML/types/environment settings and forwarding to scheduled processes.
- `tts-engine.ts`: provider routing, Audio Chat/Speech HTTP contracts, strict transcript checking, and Edge narration.
- `tts-text.ts`, `mp3.ts`: bounded text splitting, transcript normalization, MP3 validation, and duration reading.
- `tts.ts`, `tts-worker.ts`: process isolation, structured errors, staging, cancellation, and atomic publication of output.
- `admin.ts`, `onboarding.ts`: conditional configuration, masked-key preservation, private previews, and readiness reporting.

See [ADR 0001](adr/0001-support-separate-openai-audio-contracts.md) for the API-contract tradeoff and [TTS.md](../TTS.md) for operating instructions and environment variables.

## Verification boundary

Verified: `npm run build`; 83 passing tests in 11 files; Playwright checks of provider switching, saved Edge/OpenAI values, both API-mode previews, playback of the local MP3, and a 390-pixel mobile layout without horizontal overflow. FFmpeg decoded a three-chunk MP3 without errors after removing per-file ID3/Xing metadata, and its duration matched the frame-based duration calculation.

Automated verification uses local mock providers and an offline synthetic MP3. It checks legacy defaults, validation and persistence, secret masking, both API contracts, transcript rejection, lossless long-text splitting, worker cleanup, authenticated previews, and no preview publication. Real OpenAI narration quality, account permissions, and billing require a real-provider check and have not been verified by these tests.

## Official references checked on 2026-10-31

- [OpenAI Audio Chat Completions](https://developers.openai.com/api/docs/guides/audio-chat-completions)
- [OpenAI GPT-Audio-1.5](https://developers.openai.com/api/docs/models/gpt-audio-1.5)
- [OpenAI Create speech](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)
- [OpenAI Deprecations](https://developers.openai.com/api/docs/deprecations)

OpenAI schedules `tts-1`, `tts-1-hd`, and `gpt-4o-mini-tts` for shutdown on 2027-01-06. `gpt-audio-1.5` uses Audio Chat mode, not `/audio/speech`; compatible services have their own lifecycle.
