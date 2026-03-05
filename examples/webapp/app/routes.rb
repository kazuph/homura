# Homura Routes - Define your application routes here
# This is the main file you'll edit to build your app

# ===== Middleware =====
# 共通ミドルウェア: /api/* のJSON APIでは本文付きPOST/PUT/PATCH時にContent-Type検証
def require_json_content_type(ctx)
  method = ctx.req.method
  return false unless method == "POST" || method == "PUT" || method == "PATCH"
  return false unless ctx.req.path.start_with?("/api/")
  return false if ctx.req.text.to_s.empty?
  content_type = ctx.req.header("content-type").to_s
  !content_type.include?("application/json")
end

$app.use do |ctx, nxt|
  if require_json_content_type(ctx)
    ctx.json({ error: "Content-Type must be application/json" }, status: 415)
  else
    nxt.call
  end
end

def normalize_todo_row(row)
  return nil unless row.is_a?(Hash)
  completed = row["completed"]
  completed = row[:completed] unless row.key?("completed")
  id = row["id"]
  id = row[:id] unless row.key?("id")

  row["completed"] =
    if completed == true || completed == 1 || completed == "1" || (completed.is_a?(String) && completed.downcase == "true")
      true
    else
      false
    end
  row["id"] = id.to_i unless id.nil?
  row
end

def normalize_todo_list(raw_rows)
  return [] unless raw_rows.is_a?(Array)
  raw_rows.map { |row| normalize_todo_row(row) }.compact
end

def parse_todo_title(body)
  return nil unless body.is_a?(Hash)
  title = body[:title]
  title = body["title"] if title.nil?
  return nil if title.nil?

  normalized = title.to_s.strip
  normalized.empty? ? nil : normalized
end

def parse_todo_completed(body)
  return nil unless body.is_a?(Hash)
  value = body[:completed]
  value = body["completed"] if value.nil?
  return true if value == true || value == 1 || value == "1" || value.to_s.downcase == "true"
  return false if value == false || value == 0 || value == "0" || value.to_s.downcase == "false"
  nil
end

def parse_todo_payload(body)
  return nil unless body.is_a?(Hash)
  {
    title: parse_todo_title(body),
    completed: parse_todo_completed(body),
  }
end

def parse_todo_id(ctx)
  value = ctx.req.param("id")
  return nil if value.nil?
  id = value.to_i
  id > 0 ? id : nil
end

# ===== Pages =====

$app.get "/" do |c|
  rows = c.db.all("SELECT id, title, completed, created_at, updated_at, completed_at FROM todos ORDER BY id DESC")
  todos = normalize_todo_list(rows)
  c.jsx("home", { todos: todos.to_json }, status: 200)
end

$app.get "/api/todos" do |c|
  rows = c.db.all("SELECT id, title, completed, created_at, updated_at, completed_at FROM todos ORDER BY id DESC")
  c.json(normalize_todo_list(rows))
end

$app.post "/api/todos" do |c|
  body = c.json_body
  payload = parse_todo_payload(body)
  title = payload && payload[:title]
  unless title
    return c.json({ error: "title is required" }, status: 400)
  end

  inserted = c.db.run(
    "INSERT INTO todos (title, completed, created_at, updated_at) VALUES (?, 0, datetime('now'), datetime('now'))",
    [title]
  )
  last_row_id = inserted["last_row_id"]
  return c.json({ error: "Failed to insert todo" }, status: 500) unless last_row_id

  todo = c.db.get(
    "SELECT id, title, completed, created_at, updated_at, completed_at FROM todos WHERE id = ?",
    [last_row_id.to_i],
  )
  return c.json({ error: "Failed to load created todo" }, status: 500) unless todo

  c.json(normalize_todo_row(todo), status: 201)
end

$app.get "/api/todos/:id" do |c|
  id = parse_todo_id(c)
  return c.json({ error: "Invalid todo id" }, status: 400) unless id

  todo = c.db.get(
    "SELECT id, title, completed, created_at, updated_at, completed_at FROM todos WHERE id = ?",
    [id]
  )
  return c.json({ error: "Todo not found" }, status: 404) unless todo
  c.json(normalize_todo_row(todo))
end

$app.put "/api/todos/:id" do |c|
  id = parse_todo_id(c)
  return c.json({ error: "Invalid todo id" }, status: 400) unless id

  body = c.json_body
  payload = parse_todo_payload(body)
  title = payload && payload[:title]
  completed = payload && payload[:completed]

  updates = []
  binds = []
  if title
    updates << "title = ?"
    binds << title
  end
  unless completed.nil?
    updates << "completed = ?"
    binds << (completed ? 1 : 0)
  end
  return c.json({ error: "title or completed is required" }, status: 400) if updates.empty?

  updates_sql = updates.join(", ")
  updates << "updated_at = datetime('now')"
  if completed.nil?
    updates_sql = updates.join(", ")
  else
    updates << (completed ? "completed_at = datetime('now')" : "completed_at = NULL")
    updates_sql = updates.join(", ")
  end

  run_result = c.db.run("UPDATE todos SET #{updates_sql} WHERE id = ?", binds + [id])
  affected_rows = run_result.is_a?(Hash) ? (run_result["affected_rows"] || run_result[:affected_rows]) : nil
  return c.json({ error: "Todo not found" }, status: 404) if affected_rows.to_i == 0

  todo = c.db.get("SELECT id, title, completed, created_at, updated_at, completed_at FROM todos WHERE id = ?", [id])
  return c.json({ error: "Failed to load todo" }, status: 500) unless todo
  c.json(normalize_todo_row(todo))
end

$app.delete "/api/todos/:id" do |c|
  id = parse_todo_id(c)
  return c.json({ error: "Invalid todo id" }, status: 400) unless id

  run_result = c.db.run("DELETE FROM todos WHERE id = ?", [id])
  affected_rows = run_result.is_a?(Hash) ? (run_result["affected_rows"] || run_result[:affected_rows]) : nil
  return c.json({ error: "Todo not found" }, status: 404) if affected_rows.to_i == 0

  c.json({ ok: true })
end

$app.get "/hello/:name" do |c|
  safe_name = View.h(c.req.param("name"))
  c.html("<h1>Hello, " + safe_name + "!</h1><p>Homura - Ruby on the Edge</p>")
end

# ===== API =====

$app.get "/api" do |c|
  c.json({ message: "Hello from Homura!", framework: "mruby + WASI", version: "0.1.0" })
end

$app.get "/health" do |c|
  c.json({ status: "ok", runtime: "cloudflare-workers", engine: "mruby" })
end

# ===== Users CRUD =====

$app.get "/users/:id" do |c|
  c.json({ user_id: c.req.param("id"), action: "show" })
end

$app.post "/users" do |c|
  c.json({ action: "create", body: c.body }, status: 201)
end

$app.put "/users/:id" do |c|
  c.json({ action: "update", user_id: c.req.param("id"), body: c.body })
end

$app.patch "/users/:id" do |c|
  c.json({ action: "patch", user_id: c.req.param("id"), body: c.body })
end

$app.delete "/users/:id" do |c|
  c.json({ action: "delete", user_id: c.req.param("id") })
end

# ===== KV Counter =====

$app.get "/counter" do |c|
  current = c.kv_get("counter")
  count = current ? current.to_i : 0
  new_count = count + 1
  c.kv_put("counter", new_count.to_s)
  c.json({ count: new_count, message: "Counter incremented!" })
end

$app.post "/counter/reset" do |c|
  c.kv_put("counter", "0")
  c.json({ count: 0, message: "Counter reset!" })
end

# ===== KV Users =====

$app.post "/kv/users/:name" do |c|
  name = c.req.param("name")
  c.kv_put("user:" + name, c.body)
  c.json({ saved: name, body: c.body }, status: 201)
end

$app.get "/kv/users/:name" do |c|
  name = c.req.param("name")
  data = c.kv_get("user:" + name)
  if data
    c.json({ user: name, data: data })
  else
    c.json({ error: "User not found" }, status: 404)
  end
end

$app.delete "/kv/users/:name" do |c|
  name = c.req.param("name")
  c.kv_delete("user:" + name)
  c.json({ deleted: name })
end

# Note: CSS is served directly from TypeScript (see index.ts)
