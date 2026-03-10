# Homura

> A Ruby DSL web framework for Cloudflare Workers, powered by mruby + WASI

Homura brings the expressiveness of Ruby to edge computing. Write your routing logic in Ruby, deploy to Cloudflare Workers. The framework compiles mruby to WebAssembly (WASI target) and communicates with the JS runtime via MessagePack IPC.

## Architecture

```
Request → index.ts (JS glue) → mruby.wasm (MessagePack IPC) → routes.rb (Ruby DSL)
                ↓                        ↓
          D1 / KV bindings         Homura framework
          (JS-side execution)      (routing, context, ORM)
```

- **Ruby side** handles: routing, request parsing, business logic, ORM queries, response building
- **JS side** handles: WASM lifecycle, D1/KV binding execution, JSX template rendering
- Communication uses MessagePack with a continuation-loop pattern for async I/O (D1 queries trigger `ContinueRequest`, JS executes the SQL, then resumes Ruby with results)

## Quick Start

```bash
cd examples/webapp
npm install
npm run bundle:ruby   # Bundle lib/homura.rb + app/routes.rb into src/ruby-bundle.ts
npm run dev            # Start wrangler dev on port 8787
```

## Sinatra-Compatible DSL

Homura's routing DSL is inspired by [Sinatra](https://sinatrarb.com/). Here's what's implemented:

### Routing

```ruby
$app.get "/hello/:name" do |c|
  c.json({ message: "Hello, #{c.params[:name]}!" })
end

$app.post "/users" do |c|
  data = c.json_body
  c.json({ created: data }, status: 201)
end
```

| Sinatra | Homura | Status |
|---------|--------|--------|
| `get '/path'` | `$app.get "/path" do \|c\| ... end` | Supported |
| `post '/path'` | `$app.post "/path" do \|c\| ... end` | Supported |
| `put '/path'` | `$app.put "/path" do \|c\| ... end` | Supported |
| `patch '/path'` | `$app.patch "/path" do \|c\| ... end` | Supported |
| `delete '/path'` | `$app.delete "/path" do \|c\| ... end` | Supported |
| `options '/path'` | `$app.options "/path" do \|c\| ... end` | Supported |
| Route params `'/users/:id'` | `c.params[:id]` | Supported |
| Wildcard `'/files/*'` | `c.params[:_wildcard]` | Supported |
| Optional params `'/users/:id?'` | Supported | Supported |
| Regex constraints `'/users/:id{[0-9]+}'` | Supported | Supported |

### Helpers

```ruby
$app.helpers do
  def format_date(time)
    time.strftime("%Y-%m-%d")
  end
end

# Available in all route handlers via `c.format_date(time)`
```

| Sinatra | Homura | Status |
|---------|--------|--------|
| `helpers do ... end` | `$app.helpers do ... end` | Supported |
| `helpers MyModule` | Not supported (block-only) | Partial |

### Configuration

```ruby
$app.configure do |app|
  app.set :app_name, "My App"
  app.enable :logging
end

$app.configure :production do |app|
  app.disable :debug
end
```

| Sinatra | Homura | Status |
|---------|--------|--------|
| `configure do ... end` | `$app.configure do \|app\| ... end` | Supported |
| `configure :production do ... end` | Environment-scoped configure | Supported |
| `set :key, value` | `$app.set :key, value` | Supported |
| `enable :feature` | `$app.enable :feature` | Supported |
| `disable :feature` | `$app.disable :feature` | Supported |
| `settings.key` | `$app.settings[:key]` | Supported |

### Request Handling

| Sinatra | Homura | Status |
|---------|--------|--------|
| `params[:name]` | `c.params[:name]` | Supported |
| `request.body` | `c.req.text` / `c.req.json` | Supported |
| `request.path` | `c.req.path` | Supported |
| `request.request_method` | `c.req.method` | Supported |
| `request.query_string` | `c.req.query` / `c.req.query(:key)` | Supported |
| `request.url` | `c.req.url` | Supported |
| `request.env['HTTP_X_FOO']` | `c.req.header("X-Foo")` | Supported |
| `halt 403` | `c.halt(403)` | Supported |
| `halt 200, 'OK'` | `c.halt(200, nil, "OK")` | Supported |

### Response Helpers

```ruby
$app.get "/api/data" do |c|
  c.json({ key: "value" })           # Content-Type: application/json
end

$app.get "/page" do |c|
  c.html("<h1>Hello</h1>")           # Content-Type: text/html
end

$app.get "/greeting" do |c|
  c.text("Hello, World!")            # Content-Type: text/plain
end

$app.get "/home" do |c|
  c.jsx("home", { title: "Top" })    # JSX server-side rendering
end
```

| Sinatra | Homura | Status |
|---------|--------|--------|
| `content_type :json; body data.to_json` | `c.json(data)` | Supported |
| `erb :template` | `c.jsx("template", props)` | Supported (JSX instead of ERB) |
| `redirect '/path'` | `c.redirect("/path")` | Supported |
| `status 201` | `c.status(201)` | Supported |
| `headers "X-Custom" => "value"` | `c.header("X-Custom", "value")` | Supported |
| `cookies[:name]` | `c.cookie("name")` | Supported |
| `response.set_cookie` | `c.set_cookie(name, value, opts)` | Supported |
| `session[:key]` | `c.session[:key]` (cookie-based) | Supported |

### Middleware

```ruby
# Global middleware (runs on all routes)
$app.use do |ctx, nxt|
  ctx.header("X-Powered-By", "Homura")
  nxt.call
end

# Route-scoped middleware
$app.use "/admin" do |ctx, nxt|
  # Auth check for /admin routes only
  nxt.call
end
```

| Sinatra | Homura | Status |
|---------|--------|--------|
| `before do ... end` | `$app.use do \|ctx, nxt\| ... end` | Supported (Hono-style) |
| `after do ... end` | `$app.after do ... end` | Supported |
| Route-scoped middleware | `$app.use "/path" do ... end` | Supported |

### Error Handling

```ruby
$app.not_found do |c|
  c.json({ error: "Not found" }, status: 404)
end

$app.on_error do |e, c|
  c.json({ error: e.message }, status: 500)
end
```

| Sinatra | Homura | Status |
|---------|--------|--------|
| `not_found do ... end` | `$app.not_found do ... end` | Supported |
| `error do ... end` | `$app.on_error do ... end` | Supported |
| `error 404 do ... end` | Not supported (use `not_found`) | Not yet |

### Not Yet Supported

| Sinatra Feature | Status |
|----------------|--------|
| `before '/path' do ... end` (filter syntax) | Use `$app.use "/path"` instead |
| Named routes (`url(:name)`) | Not yet |
| Streaming responses | Not yet |
| WebSocket | Not yet |
| File uploads / multipart | Not yet |
| `error 404 do` (status-specific error blocks) | Not yet |
| Template engines (ERB, Haml, Slim) | JSX only |
| Class-based app (`class MyApp < Sinatra::Base`) | Global `$app` only |

## Homura::Model (ActiveRecord-Style ORM)

`Homura::Model` provides an ActiveRecord-inspired ORM for Cloudflare D1 (SQLite). It's defined in `lib/homura_model.rb`.

### Model Definition

```ruby
class Article < Homura::Model
  table :articles

  column :id,        :integer
  column :title,     :string
  column :body,      :string
  column :author,    :string
  column :published, :boolean

  validates :title, presence: true
  validates :author, presence: true
end
```

### Query Interface

```ruby
# Find by ID
article = Article.find(c.db, 1)

# Where conditions (Hash only - no raw SQL for security)
articles = Article.where(author: "Alice").all(c.db)

# Chaining: where + order + limit + offset
articles = Article.where(published: true)
                  .order("created_at DESC")
                  .limit(10)
                  .offset(20)
                  .all(c.db)

# Count
count = Article.where(published: true).count(c.db)

# First record
article = Article.where(title: "Hello").first(c.db)
```

| ActiveRecord | Homura::Model | Status |
|-------------|---------------|--------|
| `Article.find(1)` | `Article.find(c.db, 1)` | Supported |
| `Article.where(key: val)` | `Article.where(key: val)` | Supported (Hash only) |
| `Article.where("sql")` | Not supported (security) | Intentionally omitted |
| `.order("col DESC")` | `.order("col DESC")` | Supported |
| `.limit(10)` | `.limit(10)` | Supported |
| `.offset(20)` | `.offset(20)` | Supported |
| `.all` | `.all(c.db)` | Supported (requires db arg) |
| `.first` | `.first(c.db)` | Supported |
| `.count` | `.count(c.db)` | Supported |

### CRUD Operations

```ruby
# Create
article = Article.create(c.db, title: "Hello", author: "Alice")

# Read
article = Article.find(c.db, 1)
article.title  #=> "Hello"

# Update
article.update_attrs(c.db, title: "Updated Title")
# or
article.title = "Updated Title"
article.save(c.db)

# Delete
article.destroy(c.db)
```

| ActiveRecord | Homura::Model | Status |
|-------------|---------------|--------|
| `Model.create(attrs)` | `Model.create(c.db, attrs)` | Supported |
| `record.save` | `record.save(c.db)` | Supported |
| `record.update(attrs)` | `record.update_attrs(c.db, attrs)` | Supported |
| `record.destroy` | `record.destroy(c.db)` | Supported |
| `record.valid?` | `record.valid?` | Supported |
| `record.errors` | `record.errors` (array of strings) | Supported |
| `record.persisted?` | `record.persisted?` | Supported |
| `record.to_h` | `record.to_h` | Supported |
| `record.attribute = val` | `record.attribute = val` (via method_missing) | Supported |

### Validations

```ruby
class Article < Homura::Model
  validates :title, presence: true
  validates :author, presence: true
end

article = Article.new(title: "", author: "Alice")
article.valid?   #=> false
article.errors   #=> ["title can't be blank"]
```

| ActiveRecord | Homura::Model | Status |
|-------------|---------------|--------|
| `validates :field, presence: true` | Supported | Supported |
| `validates :field, uniqueness: true` | Not yet | Not yet |
| `validates :field, format: { with: /regex/ }` | Not yet | Not yet |
| `validates :field, length: { max: 100 }` | Not yet | Not yet |
| Custom validations | Not yet | Not yet |

### Type Casting

The ORM automatically casts column values based on declared types:

| Column Type | Ruby Type | DB Storage |
|------------|-----------|------------|
| `:integer` | `Integer` | INTEGER |
| `:boolean` | `true/false` | INTEGER (0/1) |
| `:string` | `String` | TEXT |

### Design Decisions

- **`c.db` required**: Unlike ActiveRecord's global connection, Homura passes the D1 database handle explicitly. This is because Cloudflare Workers' D1 is request-scoped.
- **No raw SQL in `where()`**: `where("1=1; DROP TABLE x")` is intentionally rejected. Only Hash conditions are accepted to prevent SQL injection.
- **No associations**: `has_many`, `belongs_to` are not implemented. Use explicit queries.
- **No migrations**: Use D1's native SQL migration files (`migrations/*.sql`).
- **No callbacks**: `before_save`, `after_create` etc. are not implemented.

## Cloudflare Bindings

### D1 (SQLite Database)

```ruby
# Via ORM
articles = Article.where(published: true).all(c.db)

# Direct SQL (low-level)
result = c.db.all("SELECT * FROM articles WHERE published = ?", [1])
row = c.db.get("SELECT * FROM articles WHERE id = ?", [1])
c.db.run("INSERT INTO articles (title) VALUES (?)", ["Hello"])
```

### KV (Key-Value Storage)

```ruby
value = c.kv_get("my-key")
c.kv_put("my-key", "my-value")
c.kv_delete("my-key")
```

## mrbgems

The WASI build includes 30 mrbgems. 17 were added in this release:

| Gem | Category | What It Enables |
|-----|----------|----------------|
| `mruby-time` | Standard lib | `Time.now`, timestamps, time arithmetic |
| `mruby-random` | Standard lib | `Random.new`, `rand()`, secure random generation |
| `mruby-pack` | Standard lib | `Array#pack`, `String#unpack` - binary encoding/decoding |
| `mruby-eval` | Metaprogramming | `eval`, `instance_eval`, `module_eval` |
| `mruby-metaprog` | Metaprogramming | `define_method`, `define_singleton_method`, `send`, `respond_to?` |
| `mruby-binding` | Metaprogramming | `Binding` objects for closures |
| `mruby-enumerator` | Collections | `Enumerator`, `each_with_object`, `map`, `select` |
| `mruby-enum-lazy` | Collections | `Lazy` enumerators for memory-efficient pipelines |
| `mruby-set` | Collections | `Set` class for unique collections |
| `mruby-data` | Data types | Immutable value objects (`Data.define`) |
| `mruby-bigint` | Numeric | Arbitrary-precision integers |
| `mruby-rational` | Numeric | Rational number arithmetic |
| `mruby-fiber` | Concurrency | Fiber-based coroutines |
| `mruby-enum-chain` | Collections | `Enumerator::Chain` for chaining enumerators |
| `mruby-catch` | Control flow | `catch`/`throw` for non-local jumps |
| `mruby-compar-ext` | Core ext | `Comparable#clamp` |
| `mruby-numeric-ext` | Core ext | Extended numeric methods |

Previously included (13 gems): `mruby-sprintf`, `mruby-math`, `mruby-struct`, `mruby-enum-ext`, `mruby-string-ext`, `mruby-array-ext`, `mruby-hash-ext`, `mruby-range-ext`, `mruby-proc-ext`, `mruby-symbol-ext`, `mruby-object-ext`, `mruby-kernel-ext`, `mruby-class-ext`, `mruby-method`, `mruby-error`, `mruby-compiler`.

## Examples

Each example demonstrates specific mrbgems and framework features:

| Example | Description | Key mrbgems / Features |
|---------|-------------|----------------------|
| [webapp](examples/webapp/) | Todo App with full CRUD | D1, JSX templates, per-request VM lifecycle |
| [url-shortener](examples/url-shortener/) | Base62 URL shortening with click tracking | mruby-random, mruby-pack, KV storage |
| [json-transform](examples/json-transform/) | JSON data pipeline (filter, map, group, dedupe) | mruby-enumerator, mruby-enum-lazy, mruby-set |
| [template-engine](examples/template-engine/) | Variable interpolation + HTML escaping | mruby-metaprog (define_singleton_method) |
| [time-tracker](examples/time-tracker/) | Event logging with time-windowed stats | mruby-time, mruby-pack, mruby-bigint, D1 |
| [dsl-api](examples/dsl-api/) | DSL-driven auto CRUD generation | Homura::Model ORM, mruby-metaprog, D1 |

### Running an example

```bash
cd examples/<name>
npm install
npm run bundle:ruby   # Bundles lib/homura.rb + app/routes.rb
npm run dev            # Starts wrangler dev server
```

### Running E2E tests

```bash
# From repository root
cd e2e
npm install
BASE_URL=http://127.0.0.1:<port> npx playwright test <example>.spec.ts
```

## Development

### Prerequisites

- [wasi-sdk](https://github.com/WebAssembly/wasi-sdk) (for building mruby to WASM)
- [wrangler](https://developers.cloudflare.com/workers/wrangler/) (Cloudflare Workers CLI)

### Building mruby.wasm

```bash
cd mruby
make setup    # Clone mruby 3.3.0 source
make          # Build mruby.wasm (~790KB)
```

### Project Structure

```
homura/
├── lib/
│   ├── homura.rb           # Framework core (routing, context, middleware, Sinatra-compat)
│   └── homura_model.rb     # Homura::Model ORM
├── mruby/
│   ├── build_config.rb     # 30 mrbgems for WASI build
│   └── src/homura_entry.c  # C API (MessagePack IPC)
├── examples/
│   ├── webapp/             # Todo app (D1 + JSX)
│   ├── url-shortener/      # Base62 + KV
│   ├── json-transform/     # Enumerable pipeline
│   ├── template-engine/    # Metaprogramming template
│   ├── time-tracker/       # Time + bigint + D1
│   └── dsl-api/            # ORM auto-CRUD
└── e2e/                    # Playwright E2E tests
```

## Inspiration

- [Hono](https://hono.dev/) - Ultrafast web framework for the Edge
- [Sinatra](https://sinatrarb.com/) - DSL for quickly creating web applications in Ruby
- [ActiveRecord](https://guides.rubyonrails.org/active_record_basics.html) - ORM pattern for Ruby
- [mruby](https://mruby.org/) - Lightweight implementation of Ruby

## License

MIT
