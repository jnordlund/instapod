---
status: accepted
---

# Add Realtime narration as an explicit third API mode

The user requested support for `gpt-realtime-2.1-mini` on 2026-10-31. It uses the Realtime contract, so Audio Chat Completions and Speech API cannot run it. This decision replaces the Realtime deferral in [ADR 0001](0001-support-separate-openai-audio-contracts.md); its explicit-mode selection and no-fallback decisions still apply.

Add `realtime` alongside `audio-chat` and `speech` under the OpenAI-compatible provider. Keep Edge TTS as the provider default and preserve existing settings. Do not select a protocol implicitly from a model name. The form suggests `gpt-realtime-2.1-mini` when moving from the default Audio Chat model into Realtime; custom names remain editable.

Use server-side GA WebSocket sessions at the configured HTTP(S) base URL plus `/realtime?model=...`, converting the scheme to WS(S). Credentials stay in Authorization headers. Each losslessly bounded 1,500-character chunk receives a fresh session with tools and voice activity detection disabled, explicit narration instructions, and an out-of-band response containing just that text. Wait for session configuration acknowledgement before sending article text.

Request mono PCM16 audio at 24 kHz. Require a completed response and an output transcript matching the source under the existing conservative normalization rules. Match streamed audio to its response, item, and content part; reject missing, truncated, malformed, or unmatched output. This verifies the model's returned transcript, not the spoken audio independently.

Encode PCM to MP3 with FFmpeg in the isolated worker, using the existing staging and atomic output publication. Include FFmpeg in the Docker runtime and check for it before opening a paid session. Realtime is the only mode requiring the local encoder. The worker propagates cancellation to the socket and encoder; deadlines and byte limits bound stalled or excessive output. No automatic retries or fallback to Edge are added.

Realtime voice suggestions follow OpenAI's documented list; manual names support compatible services. Numeric speed is limited to 0.25–1.5 for Realtime, independently of Speech API's 0.25–4 range. Model discovery remains advisory, and the existing private voice preview tests the selected protocol using unsaved settings.

References: [model](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini), [client events](https://developers.openai.com/api/reference/resources/realtime/client-events), [server events](https://developers.openai.com/api/reference/resources/realtime/server-events), [conversations](https://developers.openai.com/api/docs/guides/realtime-conversations), checked 2026-10-31.
