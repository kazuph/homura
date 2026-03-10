# Time Tracker

A time-oriented demo that records named events in D1, summarizes them by time window, and generates rolling time-based tokens from Ruby.

## What it demonstrates

- Time calculations with `mruby-time`
- Binary packing/unpacking with `mruby-pack`
- Large integer handling with `mruby-bigint`
- D1-backed event storage and aggregate queries

## Run locally

```bash
npm install
npm run bundle:ruby
npx wrangler d1 migrations apply homura-db --local
npm run dev
```

## Main endpoints

- `POST /events` - create an event with the current timestamp
- `GET /events?window=3600` - list recent events in a window
- `GET /events/stats` - aggregate counts and durations by event name
- `GET /token?seed=mysecret&window=30` - generate a rolling time token
- `GET /` - HTML UI
- `GET /api`, `GET /api/test-gems` - docs and gem verification

## Architecture

- `src/index.ts` runs the Worker bridge and initializes mruby.
- `app/routes.rb` contains the time utilities, token generator, and D1 queries.
- `src/templates.tsx` exposes forms for logging events and inspecting stats.
- D1 stores raw events; Ruby computes formatted durations and token metadata.

## Ruby DSL snippet

```ruby
$app.get "/events/stats" do |c|
  rows = c.db.all("SELECT name, COUNT(*) as count FROM events GROUP BY name ORDER BY count DESC")
  c.json({ stats: rows || [] })
end
```
