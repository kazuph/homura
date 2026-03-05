# Homura 🔥

> A Ruby DSL web framework for Cloudflare Workers, powered by mruby + WASI

Homura (炎 - flame) brings the expressiveness of Ruby to edge computing. Write your routing logic in Ruby, deploy to Cloudflare Workers.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Cloudflare Workers                         │
├──────────────────────────────────────────────────────────────┤
│  ┌───────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │  Request  │───▶│   index.ts   │───▶│    Response      │  │
│  └───────────┘    │  (JS glue)   │    └──────────────────┘  │
│                   └──────┬───────┘                           │
│                     ┌────┴─────┐                             │
│              ┌──────▼──────┐ ┌─▼──────────┐                 │
│              │ mruby.wasm  │ │ D1 / KV    │                 │
│              │ (MessagePack│ │ (direct JS) │                 │
│              └──────┬──────┘ └────────────┘                 │
│              ┌──────▼──────┐                                │
│              │  routes.rb  │                                │
│              │  (Ruby DSL) │                                │
│              └─────────────┘                                │
└──────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
cd examples/webapp
npm install
npm run dev
```

## Example: To-Do App

The included example (`examples/webapp/`) is a full To-Do app with D1 persistence:

- **Home page** (`/`) - To-Do list UI with add/toggle/delete/filter
- **REST API** (`/api/todos`) - CRUD endpoints backed by Cloudflare D1
- **Ruby routes** - Additional routes defined in `app/routes.rb`

## Ruby DSL

```ruby
$app.get "/hello/:name" do |c|
  c.json({ message: "Hello, #{c.params[:name]}!" })
end

$app.post "/users" do |c|
  data = c.json_body  # Parsed JSON body
  c.json({ created: data }, status: 201)
end

# Middleware (runs before route handlers)
$app.use do |ctx, nxt|
  # Add custom logic before/after route handling
  nxt.call
end
```

## Features

- **Ruby DSL**: Sinatra/Hono-like routing (`get`, `post`, `put`, `patch`, `delete`)
- **Middleware chain**: `use` with `next` pattern for composable request pipeline
- **MessagePack IPC**: Secure request handling (no eval injection)
- **D1 Database**: Cloudflare D1 (SQLite) for persistence
- **KV Storage**: Cloudflare KV for key-value operations
- **JSX Templates**: TypeScript/JSX server-side rendering
- **Edge-native**: Optimized for Cloudflare Workers
- **Lightweight**: mruby core (~790KB wasm)

## Development

### Prerequisites

1. **wasi-sdk** (for building mruby to WASM):
   ```bash
   # Install to ~/.local/wasi-sdk
   ```

2. **wrangler** (Cloudflare Workers CLI):
   ```bash
   npm install -g wrangler
   ```

### Building mruby.wasm

```bash
cd mruby
make setup    # Clone mruby source
make          # Build mruby.wasm (~790KB)
```

### Running locally

```bash
cd examples/webapp
npm install
npm run dev   # Starts wrangler dev on port 8787
```

### Deploying

```bash
cd examples/webapp
# Apply D1 migrations first
npx wrangler d1 migrations apply homura-db --remote
npx wrangler deploy
```

## Project Structure

```
homura/
├── lib/
│   └── homura.rb           # Framework core (routing, context, middleware)
├── mruby/
│   ├── Makefile             # WASI build script
│   ├── build_config.rb      # mruby cross-compile config
│   ├── src/
│   │   └── homura_entry.c   # C API (init, eval, handle_request via MessagePack)
│   └── build/
│       └── mruby.wasm       # Compiled output
├── examples/
│   └── webapp/
│       ├── src/
│       │   ├── index.ts       # Worker entry + D1 handler + mruby integration
│       │   ├── templates.tsx   # JSX templates (To-Do app UI)
│       │   ├── ruby-bundle.ts  # Bundled Ruby code (auto-generated)
│       │   ├── styles-bundle.ts # Bundled CSS (auto-generated)
│       │   └── lib/
│       │       ├── jsx-runtime.ts  # Custom JSX factory
│       │       └── render.ts       # renderToString implementation
│       ├── app/
│       │   ├── routes.rb      # User-defined Ruby routes
│       │   └── styles.css     # Application CSS
│       ├── migrations/
│       │   └── 0001_create_todos.sql  # D1 schema
│       ├── wrangler.toml      # Cloudflare config (D1, KV bindings)
│       └── package.json
└── README.md
```

## Roadmap

- [x] mruby WASI integration
- [x] MessagePack request handling (security)
- [x] Path parameter extraction
- [x] KV storage operations
- [x] D1 database integration (To-Do CRUD)
- [x] JSX template engine
- [x] Middleware system (`use`/`next`)
- [x] JSON body parsing (`json_body`)
- [ ] Query string parsing
- [ ] Session/cookie helpers
- [ ] WebSocket support

## Inspiration

- [Hono](https://hono.dev/) - Ultrafast web framework for the Edge
- [Sinatra](https://sinatrarb.com/) - DSL for quickly creating web applications
- [mruby](https://mruby.org/) - Lightweight implementation of Ruby

## License

MIT
