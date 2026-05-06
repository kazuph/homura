# ai-chat

The smallest Workers AI chat example in this repository.

- One `app.rb`
- Classic Sinatra routes
- Kimi K2.6 text in, text out
- No JavaScript, no database, no sessions

## Routes

- `GET /` — form UI
- `POST /chat` — send one prompt to Workers AI

## Local run

```bash
bundle install
npm install
bundle exec rake build
bundle exec rake dev
```

Then open the printed `*.localhost` URL and submit a message.

## Deploy

```bash
bundle exec rake deploy
```

`wrangler.toml` already binds Workers AI as `AI`, so the deployed Worker can
call `ai.chat_text(...)` directly from Ruby.
