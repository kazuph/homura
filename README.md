# Homura 🔥

> A Ruby DSL web framework for Cloudflare Workers, powered by mruby + WASI

Homura (炎 - flame) brings the expressiveness of Ruby to edge computing. Write your routing logic in Ruby, deploy to Cloudflare Workers.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Cloudflare Workers                    │
├─────────────────────────────────────────────────────────┤
│  ┌───────────┐    ┌──────────────┐    ┌─────────────┐  │
│  │  Request  │───▶│   index.ts   │───▶│  Response   │  │
│  └───────────┘    │  (JS glue)   │    └─────────────┘  │
│                   └──────┬───────┘                      │
│                          │                              │
│                   ┌──────▼───────┐                      │
│                   │  mruby.wasm  │                      │
│                   │  (WASI)      │                      │
│                   └──────┬───────┘                      │
│                          │                              │
│                   ┌──────▼───────┐                      │
│                   │  routes.rb   │                      │
│                   │  (Ruby DSL)  │                      │
│                   └──────────────┘                      │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
cd claude
npm install
npm run dev
```

## Ruby DSL Example

```ruby
app = Homura.new

app.get "/" do |c|
  c.json({ message: "Hello from Homura!" })
end

app.get "/users/:id" do |c, params|
  c.json({ user_id: params[:id] })
end

app.post "/api/data" do |c|
  c.json({ received: c.request.body })
end
```

## Features

- **Ruby DSL**: Expressive Sinatra-like routing syntax
- **Edge-native**: Optimized for Cloudflare Workers
- **Lightweight**: mruby core (~500KB wasm)
- **Type-safe params**: Automatic path parameter extraction
- **Middleware support**: Composable request pipeline

## Development

### Prerequisites

1. **wasi-sdk** (for building mruby to WASM):
   ```bash
   # macOS
   brew tap aspect-build/aspect-build
   brew install --cask aspect-build/aspect/wasi-sdk
   ```

2. **wrangler** (Cloudflare Workers CLI):
   ```bash
   npm install -g wrangler
   ```

### Building mruby.wasm

```bash
cd mruby
make setup    # Clone mruby source
make          # Build mruby.wasm
```

### Running locally

```bash
npm run dev
```

### Deploying

```bash
npm run deploy
```

## Project Structure

```
claude/
├── src/
│   └── index.ts      # JS entrypoint & WASI glue
├── app/
│   └── routes.rb     # Ruby application routes
├── mruby/
│   ├── Makefile      # Build script
│   ├── build_config.rb
│   └── build/
│       └── mruby.wasm
├── package.json
├── wrangler.toml
└── README.md
```

## Roadmap

- [ ] Complete mruby WASI integration
- [ ] Request body parsing (JSON, form)
- [ ] Query string parsing
- [ ] Middleware system
- [ ] Session/cookie helpers
- [ ] WebSocket support
- [ ] Static file serving
- [ ] Template engine (ERB-like)

## Inspiration

- [Hono](https://hono.dev/) - Ultrafast web framework for the Edge
- [Sinatra](https://sinatrarb.com/) - DSL for quickly creating web applications
- [mruby](https://mruby.org/) - Lightweight implementation of Ruby

## License

MIT
