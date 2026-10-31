# Instapod

Instapod turns saved articles into spoken podcast episodes.

## Language

**TTS provider**:
The speech service selected to narrate articles for Instapod. Edge TTS and services accessed through OpenAI-compatible audio APIs are distinct providers.
_Avoid_: Translation provider, model

**Narration voice**:
The voice selected within a TTS provider to read articles aloud. Each provider has its own voice selection, and the selected OpenAI-compatible voice applies across article languages.
_Avoid_: TTS provider, language
