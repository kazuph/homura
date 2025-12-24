# Homura Routes - Define your application routes here
# This is the main file you'll edit to build your app

# ===== Pages =====

$app.get "/" do |c|
  current_count = c.kv_get("counter") || "0"
  c.jsx("home", { counter: current_count })
end

$app.get "/hello/:name" do |c|
  safe_name = View.h(c.params[:name])
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
  c.json({ user_id: c.params[:id], action: "show" })
end

$app.post "/users" do |c|
  c.json({ action: "create", body: c.body }, status: 201)
end

$app.put "/users/:id" do |c|
  c.json({ action: "update", user_id: c.params[:id], body: c.body })
end

$app.patch "/users/:id" do |c|
  c.json({ action: "patch", user_id: c.params[:id], body: c.body })
end

$app.delete "/users/:id" do |c|
  c.json({ action: "delete", user_id: c.params[:id] })
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
  name = c.params[:name]
  c.kv_put("user:" + name, c.body)
  c.json({ saved: name, body: c.body }, status: 201)
end

$app.get "/kv/users/:name" do |c|
  name = c.params[:name]
  data = c.kv_get("user:" + name)
  if data
    c.json({ user: name, data: data })
  else
    c.json({ error: "User not found" }, status: 404)
  end
end

$app.delete "/kv/users/:name" do |c|
  name = c.params[:name]
  c.kv_delete("user:" + name)
  c.json({ deleted: name })
end

# Note: CSS is served directly from TypeScript (see index.ts)
