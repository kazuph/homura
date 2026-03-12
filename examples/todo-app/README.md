# Todo App - Homura ORM Showcase

A practical todo app demonstrating Homura::Model ORM features on Cloudflare Workers (mruby + WASI).

## ORM Features Demonstrated

| Feature | Usage |
|---------|-------|
| `enum` | Todo status: pending / in_progress / done |
| `validations` (presence, length) | Todo title, Category name |
| `validations` (numericality) | Todo priority (1-3) |
| `scopes` | pending, in_progress, done, high_priority, by_category |
| `callbacks` (before_save) | Auto-update timestamps, default priority |
| `associations` (belongs_to) | Todo -> Category |
| `associations` (has_many) | Category -> Todos |
| `where.not` | Incomplete todos via `/api/todos/not-done` |
| `pluck` | Title list via `/api/todos/pluck-titles` |
| `ids` | ID list via `/api/todos/ids` |
| `exists?` | Check existence via `/api/todos/query/exists` |
| `find_or_create_by` | Upsert via `/api/todos/find-or-create` |
| `count` | Statistics via `/api/stats` |
| Dirty tracking | Change detection via `/api/todos/:id/track-changes` |

## Setup

```bash
cd examples/todo-app
pnpm install

# Apply migrations (local D1)
pnpm run db:migrate:local

# Start dev server
pnpm run dev
```

## Testing

From the repo root:

```bash
pnpm test:e2e:todo-app
```

From the example directory:

```bash
pnpm test:e2e
```

## Routes

### HTML Pages
- `GET /` - Todo list (filterable by status and category)
- `GET /todos/new` - New todo form
- `POST /todos` - Create todo
- `GET /todos/:id/edit` - Edit todo form
- `POST /todos/:id` - Update todo
- `POST /todos/:id/toggle` - Cycle status (pending -> in_progress -> done -> pending)
- `POST /todos/:id/delete` - Delete todo
- `GET /categories` - Category management
- `POST /categories` - Create category
- `POST /categories/:id/delete` - Delete category

### JSON API (ORM demos)
- `GET /api/stats` - Statistics (count + scopes)
- `GET /api/todos` - All todos as JSON
- `GET /api/todos/pluck-titles` - pluck demo
- `GET /api/todos/ids` - ids demo
- `GET /api/todos/query/exists?title=...` - exists? demo
- `POST /api/todos/find-or-create` - find_or_create_by demo
- `GET /api/todos/not-done` - where.not demo
- `PUT /api/todos/:id/track-changes` - dirty tracking demo
