# Homura Routes - Define your application routes here
# This is the main file you'll edit to build your app

# ===== CSS =====
APP_CSS = <<~CSS
:root {
  color-scheme: light;
  --bg: #f6f1e7;
  --text: #1f1a14;
  --muted: #6b5f54;
  --accent: #b44d2f;
  --accent-2: #256b7e;
  --card: #ffffff;
  --shadow: rgba(31, 26, 20, 0.12);
}

* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif;
  background: linear-gradient(180deg, #f6f1e7 0%, #efe6d7 100%);
  color: var(--text);
}

a { color: inherit; text-decoration: none; }
.container { max-width: 960px; margin: 0 auto; padding: 0 24px; }

.site-header {
  padding: 20px 0;
  border-bottom: 1px solid rgba(31, 26, 20, 0.08);
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(10px);
}

.logo { font-weight: 700; font-size: 20px; letter-spacing: 0.04em; }
.nav { display: flex; gap: 16px; font-size: 14px; }
.site-header .container { display: flex; justify-content: space-between; align-items: center; }

.hero { padding: 56px 0 32px; }
.eyebrow { text-transform: uppercase; letter-spacing: 0.12em; font-size: 12px; color: var(--muted); }
.hero h1 { font-size: 40px; margin: 8px 0; }
.lead { color: var(--muted); font-size: 18px; max-width: 620px; }

.actions { display: flex; gap: 12px; margin-top: 24px; }
.button {
  padding: 10px 18px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}
.button.ghost {
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin-bottom: 40px;
}
.card {
  background: var(--card);
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 10px 30px var(--shadow);
}

.stack { padding: 40px 0; }
.list { padding-left: 20px; color: var(--muted); }

.site-footer {
  padding: 24px 0 40px;
  color: var(--muted);
  font-size: 12px;
}

/* Counter Section */
.counter-section { padding: 32px 0; display: flex; justify-content: center; }
.counter-card {
  background: var(--card);
  border-radius: 24px;
  padding: 32px 48px;
  box-shadow: 0 10px 40px var(--shadow);
  text-align: center;
  min-width: 320px;
}
.counter-card h2 { margin: 0 0 8px; color: var(--accent); }
.counter-desc { color: var(--muted); font-size: 14px; margin: 0 0 24px; }
.counter-display {
  font-size: 72px;
  font-weight: 700;
  color: var(--accent-2);
  margin: 16px 0;
  font-feature-settings: "tnum";
}
.counter-actions { display: flex; gap: 12px; justify-content: center; margin-top: 16px; }
.counter-actions button { cursor: pointer; border: none; font-size: 16px; }
.counter-status { margin-top: 16px; font-size: 14px; color: var(--muted); min-height: 20px; }
CSS

# ===== Pages =====

$app.get "/" do |c|
  current_count = c.kv_get("counter") || "0"
  c.jsx("home", {
    eyebrow: "mruby + WASI",
    headline: "Homuraで軽量Webサーバー",
    lead: "APIだけでなく静的ページも素早く返す、Hono風のRuby DSLです。",
    template_note: "JSXテンプレで軽量にHTMLを組み立て。",
    web_note: "CSSやHTMLを同梱して小さなWebに最適。",
    hono_note: "get/post + Context APIでHono互換の使い心地。",
    counter: current_count
  })
end

$app.get "/about" do |c|
  c.jsx("about", { framework: "mruby + WASI", template_style: "JSX" })
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

# ===== Assets =====

$app.get "/assets/app.css" do |c|
  c.css(APP_CSS)
end
