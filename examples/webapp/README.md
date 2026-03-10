# Homura Todo App

A full CRUD Todo app that runs Ruby routes on Cloudflare Workers through mruby + WASI, renders HTML with JSX, and persists data in D1.

## What it demonstrates

- Ruby DSL routing with middleware and helpers
- D1-backed CRUD and KV-backed utility endpoints
- JSX server-side rendering from the Worker entrypoint
- mrbgems: `mruby-set`, `mruby-enumerator`

## Run locally

```bash
npm install
npm run bundle:ruby
npx wrangler d1 migrations apply homura-db --local
npm run dev
```

## Main endpoints

- `GET /` - Todo UI
- `GET /api/todos` - list todos
- `POST /api/todos` - create a todo
- `GET /api/todos/:id` - fetch one todo
- `PUT /api/todos/:id` - update title or completion
- `DELETE /api/todos/:id` - delete a todo
- `GET /counter`, `POST /counter/reset` - KV counter demo
- `GET /api`, `GET /health`, `GET /api/test-gems` - framework/demo info

## Architecture

- `src/index.ts` starts the Worker, boots `mruby.wasm`, and bridges requests into Ruby.
- `app/routes.rb` owns the Todo UI route, CRUD logic, middleware, and KV helpers.
- `src/templates.tsx` renders the homepage and interactive Todo UI.
- D1 stores todos; KV powers the counter and key-value demos.

## Ruby DSL snippet

```ruby
$app.get "/api/todos" do |c|
  rows = c.db.all("SELECT id, title, completed FROM todos ORDER BY id DESC")
  c.json(normalize_todo_list(rows))
end
```
