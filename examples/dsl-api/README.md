# DSL-Driven API Builder

An example of defining models with a Ruby DSL and auto-generating CRUD endpoints on top of `Homura::Model`, backed by D1 and served from Cloudflare Workers.

## What it demonstrates

- `Homura::Model` ActiveRecord-style ORM patterns
- Model declarations with Ruby DSL
- Route generation with `mruby-metaprog`
- Structured model data with `mruby-data`

## Run locally

```bash
npm install
npm run bundle:ruby
npx wrangler d1 migrations apply homura-db --local
npm run dev
```

## Main endpoints

- `GET /api/articles`, `POST /api/articles`
- `GET /api/articles/:id`, `PUT /api/articles/:id`, `DELETE /api/articles/:id`
- `GET /api/articles/published`
- `GET /api/tags`, `POST /api/tags`
- `GET /api/tags/:id`, `PUT /api/tags/:id`, `DELETE /api/tags/:id`
- `GET /` - HTML UI
- `GET /api`, `GET /api/test-gems` - docs and gem verification

## Architecture

- `src/index.ts` handles the Worker-to-mruby bridge and D1 access.
- `app/routes.rb` defines models, validations, and the `auto_crud` route generator.
- `src/templates.tsx` adds a browser UI for browsing, creating, updating, and deleting records.
- D1 stores `articles` and `tags`; `Homura::Model` handles mapping and validation.

## Ruby DSL snippet

```ruby
class Article < Homura::Model
  table :articles
  column :title, :string
  validates :title, presence: true
end

auto_crud($app, Article)
```
