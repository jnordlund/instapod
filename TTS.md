# Text-to-speech configuration

Choose **Configuration → Text-to-Speech → Provider**. Edge TTS remains the default, including for older config files. Edge voice, rate, and pitch are preserved when selecting OpenAI / compatible. Changes apply from the next pipeline run; existing episodes keep their audio.

## OpenAI / compatible

Select an explicit API mode:

| Mode | Use | Model example |
| --- | --- | --- |
| Audio Chat Completions | Current OpenAI audio generation, or a compatible audio-capable chat service | `gpt-audio-1.5` |
| Speech API | Services implementing `/audio/speech` | Your service's speech model |
| Realtime | OpenAI or services implementing GA Realtime over WebSocket | `gpt-realtime-2.1-mini` |

The default base URL is `https://api.openai.com/v1`. Enter a dedicated **TTS API Key**, model, and voice. Model and voice fields accept custom names as well as suggestions. A local service may use an empty key; no Authorization header is sent in that case. TTS does not inherit translation credentials. Secrets are masked in the admin API and stored in the YAML config like existing credentials; they are not encrypted at rest.

**Fetch models** requests `/models` from the current TTS base URL through the authenticated admin server, using the current key (including unsaved settings or a masked saved key). It fills model suggestions without replacing the typed model or saving configuration. Empty lists, missing model-list permissions, and services without `/models` leave manual entry available. Changing the base URL, key, or provider clears the old suggestions and cancels an in-flight lookup.

Model discovery does not verify speech support. The list can include non-audio models; **Test connection & voice** remains the check for a working model/voice combination. Voice suggestions come from OpenAI's documented lists for Audio Chat, Speech API, or Realtime, with the smaller list for `tts-1`/`tts-1-hd`. Suggestions never replace the typed voice; compatible services can use their own names.

Optional voice instructions describe tone and delivery. Speech API services must support the `instructions` parameter when it is supplied. Numeric speed applies to Speech API (0.25–4.0) and Realtime (0.25–1.5), with a default of 1.0. Audio Chat uses voice instructions for delivery. All episodes are MP3, and the selected OpenAI-compatible voice is used across languages.

To use `gpt-realtime-2.1-mini`, choose **Realtime** and enter that model name. The form suggests it when switching from the default Audio Chat model; custom model names are preserved. Keep the base URL as `https://api.openai.com/v1` for OpenAI. The server connects to its `/realtime` WebSocket endpoint and encodes streamed audio into MP3. A service supporting only `/audio/speech` needs **Speech API** mode instead. Realtime generates complete episode files and private previews; it does not add a live voice conversation interface.

Realtime requires `ffmpeg` on the server's PATH. It is included in the Docker image; rebuild with `docker compose up -d --build instapod` when deploying this change. For a local macOS installation, install it with `brew install ffmpeg`. Edge, Audio Chat, and Speech API do not require FFmpeg. A missing encoder is reported before opening a Realtime API session. Each Realtime text chunk has a five-minute deadline; private Realtime previews also have a five-minute overall deadline.

**Test connection & voice** tests the current form values, including unsaved changes, by generating a sample of up to 500 characters. The status shows Not tested, Checking, Connection and voice verified (green), or Connection test failed (red). A successful check names the tested model/voice and time, and offers the generated audio for playback. It verifies that the selected endpoint can generate audio with those settings, rather than merely accepting a key or listing models.

The result applies to the last explicit test in the current page, not ongoing service availability. Editing the settings cancels an in-flight test and clears the verification and stale audio; loading or saving configuration also resets the result. Preview audio is temporary: it does not save config, create an episode, update RSS, or upload to Spotify. Generation only happens after clicking the button and may incur API usage charges.

## Narration checks and failures

Audio Chat and Realtime receive instructions to read the supplied article verbatim. Their returned transcript must match the source after normalizing whitespace, punctuation, and case. A missing transcript, changed content, incomplete response, or invalid audio stops generation. Realtime uses fresh sessions for chunks of at most 1,500 characters; Audio Chat and Speech use chunks of at most 4,000 characters. Splitting preserves the full text. This conservative check may reject correct spoken numbers transcribed as words; a matching transcript is not independent verification of the actual audio. Speech API returns audio without a transcript, so this text comparison does not apply to it.

Provider errors are reported without including upstream response bodies or credentials. The app does not retry or silently fall back to Edge within a TTS attempt. The normal scheduler can retry an unprocessed article on a later run. Temporary and partial generation files are cleaned up; completed output replaces the target only after the worker succeeds. Existing episodes are not regenerated.

OpenAI-compatible generation errors identify the API mode and text chunk (for example, `TTS realtime chunk 2/8`). Transcript mismatches also report the first differing character position and both text lengths after normalization, without logging either text. A mismatch alone cannot distinguish a content omission from a number or abbreviation written as spoken words. The comparison remains strict; diagnose the returned text before changing that policy. A final pipeline-level "completed" log means the run finished; individual article failures are still reported separately and remain unprocessed for a later retry.

## YAML and environment variables

See [config.example.yaml](config.example.yaml) for a complete example. TTS configuration has this shape:

```yaml
tts:
  provider: edge-tts
  voice: sv-SE-SofieNeural
  rate: "+0%"
  pitch: "+0Hz"
  openai:
    api_mode: audio-chat
    api_base: https://api.openai.com/v1
    api_key: ""
    model: gpt-audio-1.5
    voice: alloy
    instructions: ""
    speed: 1
```

Environment overrides take precedence over YAML, including in scheduled pipeline workers:

| Environment variable | YAML setting |
| --- | --- |
| `TTS_PROVIDER` | `tts.provider` |
| `TTS_VOICE` | `tts.voice` (Edge) |
| `TTS_RATE` | `tts.rate` (Edge) |
| `TTS_PITCH` | `tts.pitch` (Edge) |
| `TTS_OPENAI_API_MODE` | `tts.openai.api_mode` |
| `TTS_OPENAI_API_BASE` | `tts.openai.api_base` |
| `TTS_OPENAI_API_KEY` | `tts.openai.api_key` |
| `TTS_OPENAI_MODEL` | `tts.openai.model` |
| `TTS_OPENAI_VOICE` | `tts.openai.voice` |
| `TTS_OPENAI_INSTRUCTIONS` | `tts.openai.instructions` |
| `TTS_OPENAI_SPEED` | `tts.openai.speed` |

## API references

Model discovery: [List models](https://developers.openai.com/api/reference/resources/models/methods/list). Voice suggestions: [Audio Chat parameters](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) and [Speech voice options](https://developers.openai.com/api/docs/guides/text-to-speech#voice-options), checked 2026-10-31.

Realtime: [GPT-Realtime-2.1 Mini](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini), [client events](https://developers.openai.com/api/reference/resources/realtime/client-events), [server events](https://developers.openai.com/api/reference/resources/realtime/server-events), and [conversations](https://developers.openai.com/api/docs/guides/realtime-conversations), checked 2026-10-31.

Checked on 2026-10-31: [Audio Chat Completions](https://developers.openai.com/api/docs/guides/audio-chat-completions), [Create speech](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create), and [deprecations](https://developers.openai.com/api/docs/deprecations). OpenAI schedules `tts-1`, `tts-1-hd`, and `gpt-4o-mini-tts` for shutdown on 2027-01-06. `gpt-audio-1.5` uses Audio Chat mode, not Speech API. Compatible services have their own models, voices, parameters, and lifecycle.
