# Instapod

Instapod turns saved articles into spoken podcast episodes.

## Language

**TTS provider**:
The speech service selected to narrate articles for Instapod. Edge TTS and services accessed through OpenAI-compatible audio APIs are distinct providers.
_Avoid_: Translation provider, model

**TTS API mode**:
The protocol used within the OpenAI-compatible TTS provider: Audio Chat Completions, Speech API, or Realtime. Realtime uses a server-side WebSocket session and local MP3 encoding; API mode is selected explicitly, independently of the model name.
_Avoid_: TTS provider, model

**Narration voice**:
The voice selected within a TTS provider to read articles aloud. Each provider has its own voice selection, and the selected OpenAI-compatible voice applies across article languages.
_Avoid_: TTS provider, language
