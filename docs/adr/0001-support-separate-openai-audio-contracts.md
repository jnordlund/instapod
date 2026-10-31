---
status: accepted
---

# Support separate OpenAI audio contracts

Instapod needs current OpenAI audio generation while retaining compatibility with TTS services that implement the Speech API. Use explicit Audio Chat Completions and Speech API modes, with Audio Chat Completions as the OpenAI default because it returns MP3 without a streaming session or local encoder. Do not infer a protocol from a model name or fall back to a different provider on failure; the API choice must remain visible and reproducible in saved configuration.

Realtime was considered because OpenAI's TTS deprecation notice recommends it, but it would add a streaming protocol and MP3 encoding to a pipeline that produces complete episode files. The user accepted this design on 2026-10-31.
