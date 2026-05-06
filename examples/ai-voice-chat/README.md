# ai-voice-chat

The third Workers AI example: audio in, transcript out, Kimi K2.6 reply, and
Aura speech playback.

## Routes

- `GET /` — upload + speaker selection UI
- `POST /chat` — Whisper transcription + Kimi reply + inline Aura audio

## Local run

```bash
bundle install
npm install
bundle exec rake build
bundle exec rake dev
```

## Deploy

```bash
bundle exec rake deploy
```

The page stays JavaScript-free by embedding the Aura MP3 as a data URL in the
HTML response.
