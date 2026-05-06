# ai-transcribe-chat

The second Workers AI example: upload or record audio, transcribe it with
Whisper, then send the transcript to Kimi K2.6.

## Routes

- `GET /` — upload form
- `POST /chat` — Whisper transcription + Kimi reply

## Local run

```bash
bundle install
npm install
bundle exec rake build
bundle exec rake dev
```

The file input uses `accept="audio/*"` and `capture`, so phones can usually
open a recorder directly.

## Deploy

```bash
bundle exec rake deploy
```
