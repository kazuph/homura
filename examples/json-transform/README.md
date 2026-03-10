# JSON Transform Pipeline

An API-first example that applies Ruby collection operations to JSON payloads on Cloudflare Workers, with a small UI for trying the pipeline interactively.

## What it demonstrates

- `Enumerable` filtering, mapping, and grouping in Ruby
- Lazy-style data processing with `mruby-enum-lazy`
- Deduplication with `mruby-set`
- Chained JSON operations executed inside mruby on Workers

## Run locally

```bash
npm install
npm run bundle:ruby
npm run dev
```

## Main endpoints

- `POST /transform/filter` - filter array items by field value
- `POST /transform/map` - pick specific fields from each record
- `POST /transform/group` - group records by a field
- `POST /transform/unique` - keep unique values by field
- `POST /transform/pipeline` - run multiple operations in sequence
- `GET /` - HTML UI
- `GET /api`, `GET /api/test-gems` - docs and gem verification

## Architecture

- `src/index.ts` loads `mruby.wasm` and hands JSON requests to Ruby.
- `app/routes.rb` performs the transformations with plain Ruby arrays, hashes, and sets.
- `src/templates.tsx` exposes ready-made payloads and response panels for quick experiments.
- No D1 or KV bindings are required for this example.

## Ruby DSL snippet

```ruby
$app.post "/transform/unique" do |c|
  body = c.json_body
  data = body["data"]
  field = body["field"]
  seen = Set.new
  result = data.each_with_object([]) do |item, rows|
    next if seen.include?(item[field])
    seen.add(item[field])
    rows << item
  end
  c.json({ result: result, unique_count: seen.length })
end
```
