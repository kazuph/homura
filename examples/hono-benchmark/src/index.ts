/**
 * Hono Benchmark - Pure TypeScript Todo API
 * Same D1 database, same operations as Homura todo-app
 * For fair performance comparison
 */
import { Hono } from 'hono';

type Bindings = { DB: D1Database };
const app = new Hono<{ Bindings: Bindings }>();

// GET / - Todo list (JSON, same queries as Homura todo-app index page)
app.get('/', async (c) => {
  const status = c.req.query('status') || '';
  const category = c.req.query('category') || '';

  let query = 'SELECT * FROM todos';
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (status === 'pending') conditions.push('status = 0');
  else if (status === 'in_progress') conditions.push('status = 1');
  else if (status === 'done') conditions.push('status = 2');

  if (category && Number(category) > 0) {
    conditions.push('category_id = ?');
    params.push(Number(category));
  }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY id DESC';

  const todos = await c.env.DB.prepare(query).bind(...params).all();
  const categories = await c.env.DB.prepare('SELECT * FROM categories ORDER BY name ASC').all();

  const total = await c.env.DB.prepare('SELECT COUNT(*) as c FROM todos').first<{ c: number }>();
  const pending = await c.env.DB.prepare('SELECT COUNT(*) as c FROM todos WHERE status = 0').first<{ c: number }>();
  const inProgress = await c.env.DB.prepare('SELECT COUNT(*) as c FROM todos WHERE status = 1').first<{ c: number }>();
  const done = await c.env.DB.prepare('SELECT COUNT(*) as c FROM todos WHERE status = 2').first<{ c: number }>();

  return c.json({
    todos: todos.results,
    categories: categories.results,
    stats: {
      total: total?.c ?? 0,
      pending: pending?.c ?? 0,
      in_progress: inProgress?.c ?? 0,
      done: done?.c ?? 0,
    },
    current_status: status,
    current_category: category,
  });
});

// GET /api/stats - Statistics
app.get('/api/stats', async (c) => {
  const total = await c.env.DB.prepare('SELECT COUNT(*) as c FROM todos').first<{ c: number }>();
  const pending = await c.env.DB.prepare('SELECT COUNT(*) as c FROM todos WHERE status = 0').first<{ c: number }>();
  const inProgress = await c.env.DB.prepare('SELECT COUNT(*) as c FROM todos WHERE status = 1').first<{ c: number }>();
  const done = await c.env.DB.prepare('SELECT COUNT(*) as c FROM todos WHERE status = 2').first<{ c: number }>();
  const highPriority = await c.env.DB.prepare('SELECT COUNT(*) as c FROM todos WHERE priority = 3').first<{ c: number }>();
  const catCount = await c.env.DB.prepare('SELECT COUNT(*) as c FROM categories').first<{ c: number }>();

  return c.json({
    total: total?.c ?? 0,
    pending: pending?.c ?? 0,
    in_progress: inProgress?.c ?? 0,
    done: done?.c ?? 0,
    high_priority: highPriority?.c ?? 0,
    categories: catCount?.c ?? 0,
  });
});

// GET /api/todos - JSON list
app.get('/api/todos', async (c) => {
  const todos = await c.env.DB.prepare('SELECT * FROM todos ORDER BY id DESC').all();
  return c.json({ data: todos.results });
});

// POST /api/todos - Create todo
app.post('/api/todos', async (c) => {
  const body = await c.req.json<{ title?: string; description?: string; priority?: number; category_id?: number }>();
  const title = (body.title || '').trim();
  if (!title) return c.json({ error: 'Title is required' }, 422);

  const result = await c.env.DB.prepare(
    "INSERT INTO todos (title, description, status, priority, category_id, created_at, updated_at) VALUES (?, ?, 0, ?, ?, datetime('now'), datetime('now'))"
  ).bind(title, body.description || '', body.priority || 2, body.category_id || null).run();

  const todo = await c.env.DB.prepare('SELECT * FROM todos WHERE id = ?').bind(result.meta.last_row_id).first();
  return c.json({ ok: true, todo });
});

// POST /api/todos/:id/toggle - Toggle status
app.post('/api/todos/:id/toggle', async (c) => {
  const id = Number(c.req.param('id'));
  const todo = await c.env.DB.prepare('SELECT * FROM todos WHERE id = ?').bind(id).first<{ status: number }>();
  if (!todo) return c.json({ error: 'Not found' }, 404);

  const nextStatus = (todo.status + 1) % 3;
  await c.env.DB.prepare("UPDATE todos SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(nextStatus, id).run();

  const updated = await c.env.DB.prepare('SELECT * FROM todos WHERE id = ?').bind(id).first();
  return c.json({ ok: true, todo: updated });
});

// DELETE /api/todos/:id - Delete
app.delete('/api/todos/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const result = await c.env.DB.prepare('DELETE FROM todos WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// POST /api/test/reset-db - Reset
app.post('/api/test/reset-db', async (c) => {
  await c.env.DB.prepare('DELETE FROM todos').run();
  await c.env.DB.prepare('DELETE FROM categories').run();
  return c.json({ ok: true });
});

export default app;
