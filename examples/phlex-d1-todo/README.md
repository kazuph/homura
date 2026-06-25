# phlex-d1-todo

> A homura-native TODO app that writes the UI as Ruby component classes,
> persists state in Cloudflare D1 through `sequel-d1`, and keeps browser
> JavaScript to one tiny Stimulus file.

## What this shows

- An upstream Phlex Ruby component workflow on homura's Sinatra/Workers
  runtime: route code returns `Components::TodoPage.new(...).call`
  instead of rendering ERB or mounting a React/Vue app.
- Upstream Literal component props: `StatCard`, `Button`, `TodoItem`, and
  `TodoPage` declare constrained keyword props before they render HTML.
- Cloudflare D1 persistence through `Sequel.connect(adapter: :d1, d1: d1)`.
- A RubyUI-inspired component set without Rails generators, ActionView,
  importmap-rails, or phlex-rails.
- Stimulus is limited to browser-only behavior: focusing the text input
  and confirming destructive submits.

## Why this example uses local homura gems

This example dogfoods the repository's current `opal-homura` and
`homura-runtime` source via `path:` gems. That is intentional: upstream
`phlex` 2.4 and `literal` 1.9 depend on Zeitwerk, and the compatibility
support for bundling those gems lives in this repository until the next
published gem release.

There are no app-local `phlex` or `literal` shims here. The component code
does `require "phlex"` and `require "literal"` and lets homura's build
prelude load the real gems and their runtime dependencies.

`ruby_ui` itself is still Rails-generator/importmap oriented, so this app
implements the same RubyUI idea as a small local `Button`/`StatCard`
component set. That keeps the boundary honest for a Sinatra/Rack Worker:
Phlex and Literal are upstream gems; RubyUI's Rails install machinery is
represented by equivalent Phlex components.

## Layout

```
phlex-d1-todo/
├── Gemfile
├── Rakefile
├── wrangler.toml                         # D1 binding "DB" -> "phlex-d1-todo"
├── app/
│   ├── app.rb                            # Sinatra routes + D1 writes
│   └── components/ui.rb                  # upstream Phlex + Literal UI classes
├── public/assets/app.js                  # tiny Stimulus controllers
└── db/migrate/001_create_todos.rb        # Sequel migration DSL
```

## Route shape

```ruby
get "/" do
  conn = require_db
  next "D1 binding missing (configure wrangler D1)" if conn.nil?

  todos = conn[:todos].order(:id).all
  content_type "text/html; charset=utf-8"
  Components::TodoPage.new(todos: todos).call
end
```

## Component shape

```ruby
class TodoItem < Components::Base
  extend Literal::Properties

  prop :id, _Integer
  prop :title, _String(length: 1..)
  prop :done, _Boolean

  def view_template
    li(class: "todo-item") do
      span(class: "todo-title") { @title }
    end
  end
end
```

## Run it

```bash
cd examples/phlex-d1-todo
bundle install
npm install

bundle exec rake db:migrate:local
bundle exec rake build
bundle exec rake dev
# -> http://phlex-d1-todo.localhost:1355/
```

Smoke-test the D1-backed routes:

```bash
curl -sS -i -X POST http://phlex-d1-todo.localhost:1355/todos -d 'title=Pay rent'
curl -sS http://phlex-d1-todo.localhost:1355/ | grep 'Pay rent'
curl -sS -i -X POST http://phlex-d1-todo.localhost:1355/todos/1/toggle
curl -sS -i -X POST http://phlex-d1-todo.localhost:1355/todos/1/delete
```

## Deploy

```bash
npx wrangler d1 create phlex-d1-todo
# paste the database_id into wrangler.toml
bundle exec rake db:migrate:remote
bundle exec rake deploy
```

## How it differs from the other frontend examples

| Example | UI source of truth | Client JS role |
|---|---|---|
| `hotwire-todo` | ERB partials + Turbo Streams | Turbo and one Stimulus autofocus controller |
| `inertia-todo` | React/Vue-style client app through Inertia props | The page is a JS app |
| `phlex-d1-todo` | Upstream Phlex + Literal component classes | Only browser-only behavior in Stimulus |

Use this example when the question is: "Can homura feel like Ruby-native
frontend development without turning the page into a JS SPA?"
