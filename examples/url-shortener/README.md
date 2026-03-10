# URL Shortener

A Base62-style URL shortener that creates short codes in Ruby, stores mappings in Workers KV, and redirects entirely from Homura routes.

## What it demonstrates

- Random code generation with `mruby-random`
- Compact string handling with `mruby-pack`
- KV-backed URL storage and click counters
- Safe redirect validation for `http://` and `https://` URLs

## Run locally

```bash
npm install
npm run bundle:ruby
npm run dev
```

## Main endpoints

- `POST /shorten` - create a short code for a URL
- `GET /s/:code` - redirect to the original URL
- `GET /api/stats/:code` - fetch click stats for one code
- `GET /` - HTML UI
- `GET /api/test-gems` - gem verification endpoint

## Architecture

- `src/index.ts` initializes mruby and forwards Worker requests to Ruby.
- `app/routes.rb` generates codes, validates schemes, and reads/writes KV keys.
- `src/templates.tsx` provides the browser UI for creating and inspecting short URLs.
- KV stores `url:<code>` and `count:<code>` pairs.

## Ruby DSL snippet

```ruby
$app.post "/shorten" do |c|
  url = c.json_body["url"]
  code = generate_code
  c.kv_put("url:#{code}", url)
  c.json({ code: code, short_url: "/s/#{code}" }, status: 201)
end
```
