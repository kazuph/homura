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
│              │ (MessagePack│ │ (binding adapter) │          │
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

## Examples

| Example | Description | Key Features |
|---------|-------------|-------------|
| [webapp](examples/webapp/) | Todo App | D1, JSX templates, CRUD |
| [url-shortener](examples/url-shortener/) | URL Shortener | mruby-random, KV, Base62 |
| [json-transform](examples/json-transform/) | JSON Pipeline | Enumerable, Lazy, Set |
| [template-engine](examples/template-engine/) | Template Engine | metaprog, HTML escaping |
| [time-tracker](examples/time-tracker/) | Time Tracker | mruby-time, pack, bigint, D1 |
| [dsl-api](examples/dsl-api/) | DSL API Builder | Homura::Model ORM, metaprog |

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

### テスト

```bash
cd examples/webapp
npm test  # Node test (.js)

cd ../.. # repository root
ruby -I. test/homura_core_test.rb
```

テスト項目は `test/homura_core_test.rb` と `examples/webapp/tests/integration-security-notes.md` を参照してください。

### Ruby-first 開発フロー（必読）

Homuraでは `/api/*` を含むアプリ挙動は原則すべて `examples/webapp/app/routes.rb` で定義します。  
TypeScript 側 (`examples/webapp/src/index.ts`) は以下だけを担当します。

- WASM初期化（mruby）
- MessagePack で `RubyRequestEnvelope` / `RubyResponse` を受け渡す
- ルート外処理（Cloudflareバインディング実行）
  - `kv_ops` の実行
  - `d1_ops` の実行
  - 継続実行ループ制御

Rubyのみで追加開発する場合は、基本的に以下だけ更新すれば済みます。

1. `examples/webapp/app/routes.rb` へのルート追加/更新
2. `examples/webapp/migrations/*.sql` の必要なDDL変更
3. `examples/webapp/src/templates.tsx` の表示整備（任意）

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
│       │   ├── index.ts       # Worker entry + MessagePack bridge + binding execution
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
- [x] Query string parsing

## Rubyファースト運用ガイドライン

- `/api/*` や `"/"` ルートは Ruby ルート定義のみで変更する
- TS 側は API 仕様変更を直接持たず、リクエスト契約(`RubyRequestEnvelope`)の整合だけ管理する
- ルーティング、バリデーション、レスポンス整形の基本原則は Ruby 側で実装する
- D1/KV の追加処理（`db`/`kv_put`/`kv_delete`）も Ruby の抽象 API から呼び出す

## Migration運用規約

- `examples/webapp/migrations/*.sql` は本番とローカルで同内容を共有し、都度履歴を追跡する
- ローカル適用:
  - `cd examples/webapp`
  - `npx wrangler d1 migrations apply homura-db --local`
- リモート適用:
  - `npx wrangler d1 migrations apply homura-db --remote`
- CI/CDでは deploy 前に `wrangler d1 migrations list homura-db` で適用状態を確認する

## Ruby移植版の受け入れ基準

- `/api/*` の主要経路の実装責務が Ruby で完結していること（TS側ルーティング実装が残らない）
- `d1_ops` / `kv_ops` は MessagePack 契約を通じてのみ実行され、外部副作用が Ruby ルートから見える形で管理されていること
- 主要機能追加時、`app/routes.rb` の変更だけで要件を満たせること（`index.ts`の編集を最小化）
- [ ] Session/cookie helpers
- [ ] WebSocket support

## Inspiration

- [Hono](https://hono.dev/) - Ultrafast web framework for the Edge
- [Sinatra](https://sinatrarb.com/) - DSL for quickly creating web applications
- [mruby](https://mruby.org/) - Lightweight implementation of Ruby

## License

MIT
