# Micro Template Engine

A tiny template engine that expands `{{variable}}` placeholders in Ruby, automatically escapes HTML, and returns rendered markup from Workers.

## What it demonstrates

- Safe variable interpolation without `instance_eval`
- HTML auto-escaping inside Ruby
- Lightweight metaprogramming-friendly structure with `mruby-metaprog`
- Registered templates and inline templates sharing one renderer

## Run locally

```bash
npm install
npm run bundle:ruby
npm run dev
```

## Main endpoints

- `POST /render` - render a named template from the registry
- `POST /render/inline` - render an inline template string
- `GET /templates` - list registered templates
- `GET /` - HTML UI
- `GET /api`, `GET /api/test-gems` - docs and gem verification

## Architecture

- `src/index.ts` boots mruby and returns HTML responses from Ruby.
- `app/routes.rb` defines `MicroTemplate`, escapes HTML, and renders templates.
- `src/templates.tsx` provides a playground UI plus preview iframe.
- Rendering happens fully inside Ruby; the browser only sends JSON requests.

## Ruby DSL snippet

```ruby
$app.post "/render/inline" do |c|
  body = c.json_body
  tmpl = MicroTemplate.new(body["template"])
  html = tmpl.render(template_locals(body["data"] || {}))
  c.html(html)
end
```
