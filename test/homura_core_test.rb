# frozen_string_literal: true

require "minitest/autorun"

require_relative "../lib/homura"

class HomuraCoreTest < Minitest::Test
  def build_env(method, path, body: "", headers: {}, query: {}, control: { continue: false })
    {
      request: {
        method: method,
        path: path,
        query: query,
        headers: headers,
        body: body,
        content_type: headers["content-type"] || headers["Content-Type"] || "",
        kv_data: {},
      },
      control: control,
    }
  end

  def test_route_match_and_param_extraction
    app = Homura.new
    app.get("/users/:id") do |ctx|
      cxt = [ctx.req.method, ctx.req.param("id")]
      ctx.json({ method: cxt[0], id: cxt[1] })
    end

    result = app.call(build_env("GET", "/users/42"))
    assert_equal 200, result["status"]
    assert_equal({ method: "GET", id: "42" }, result["body"])
  end

  def test_root_route_matches
    app = Homura.new
    app.get("/") { |ctx| ctx.html("<h1>home</h1>") }

    result = app.call(build_env("GET", "/"))
    assert_equal 200, result["status"]
    assert_equal "<h1>home</h1>", result["body"]
    assert_equal "text/html", result["headers"]["Content-Type"]
  end

  def test_middleware_order_global_first_then_route_then_handler
    order = []
    app = Homura.new

    app.use do |ctx, nxt|
      order << :global
      nxt.call
    end

    app.use "/users/:id" do |ctx, nxt|
      order << :route
      nxt.call
    end

    app.get("/users/:id") do |_ctx|
      order << :handler
      { status: 200, body: "ok" }
    end

    result = app.call(build_env("GET", "/users/abc"))
    assert_equal 200, result["status"]
    assert_equal [:global, :route, :handler], order
  end

  def test_error_handler
    app = Homura.new
    app.get("/panic") { raise RuntimeError, "boom" }
    app.on_error do |error|
      { status: 500, body: "error: #{error.message}" }
    end

    result = app.call(build_env("GET", "/panic"))
    assert_equal 500, result["status"]
    assert_equal "error: boom", result["body"]
  end

  def test_method_not_allowed
    app = Homura.new
    app.get("/only-get") { |ctx| ctx.text("ok") }
    app.post("/only-get") { |ctx| ctx.text("ok-post") }

    get_result = app.call(build_env("GET", "/only-get"))
    assert_equal 200, get_result["status"]

    post_result = app.call(build_env("POST", "/only-get"))
    assert_equal 200, post_result["status"]

    put_result = app.call(build_env("PUT", "/only-get"))
    assert_equal 405, put_result["status"]
    allow = put_result["headers"]["Allow"]
    assert_includes allow, "GET"
    assert_includes allow, "POST"
  end

  def test_json_body_preserves_commas_inside_strings
    app = Homura.new
    app.post("/todos") do |ctx|
      ctx.json(ctx.json_body)
    end

    result = app.call(
      build_env(
        "POST",
        "/todos",
        body: '{"title":"milk, eggs","notes":"bread, butter"}',
        headers: { "content-type" => "application/json" },
      ),
    )

    assert_equal 200, result["status"]
    assert_equal "milk, eggs", result["body"]["title"]
    assert_equal "bread, butter", result["body"]["notes"]
  end

  def test_json_body_can_return_string_field_directly
    app = Homura.new
    app.post("/todos") do |ctx|
      ctx.json(ctx.json_body["title"])
    end

    result = app.call(
      build_env(
        "POST",
        "/todos",
        body: '{"title":"hello"}',
        headers: { "content-type" => "application/json" },
      ),
    )

    assert_equal 200, result["status"]
    assert_equal "hello", result["body"]
  end

  def test_json_body_supports_booleans_and_arrays
    app = Homura.new
    app.post("/todos") do |ctx|
      ctx.json(ctx.json_body)
    end

    result = app.call(
      build_env(
        "POST",
        "/todos",
        body: '{"title":"hello","completed":true,"tags":["a","b"]}',
        headers: { "content-type" => "application/json" },
      ),
    )

    assert_equal 200, result["status"]
    assert_equal "hello", result["body"]["title"]
    assert_equal true, result["body"]["completed"]
    assert_equal ["a", "b"], result["body"]["tags"]
  end

  # === Phase 5: Core Routing ===

  def test_options_method
    app = Homura.new
    app.options("/cors") { |ctx| ctx.text("ok") }
    result = app.call(build_env("OPTIONS", "/cors"))
    assert_equal 200, result["status"]
    assert_equal "ok", result["body"]
  end

  def test_all_matches_any_method
    app = Homura.new
    app.all("/any") { |ctx| ctx.json({ method: ctx.req.method }) }

    %w[GET POST PUT DELETE PATCH OPTIONS].each do |m|
      result = app.call(build_env(m, "/any"))
      assert_equal 200, result["status"]
      assert_equal m, result["body"][:method]
    end
  end

  def test_on_custom_methods
    app = Homura.new
    app.on(["GET", "POST"], "/multi") { |ctx| ctx.text("ok-#{ctx.req.method}") }

    get_result = app.call(build_env("GET", "/multi"))
    assert_equal 200, get_result["status"]
    assert_equal "ok-GET", get_result["body"]

    post_result = app.call(build_env("POST", "/multi"))
    assert_equal 200, post_result["status"]
    assert_equal "ok-POST", post_result["body"]

    put_result = app.call(build_env("PUT", "/multi"))
    assert_equal 405, put_result["status"]
  end

  def test_wildcard_route
    app = Homura.new
    app.get("/api/*") { |ctx| ctx.text("wildcard") }

    result = app.call(build_env("GET", "/api/users/123"))
    assert_equal 200, result["status"]
    assert_equal "wildcard", result["body"]

    miss = app.call(build_env("GET", "/other"))
    assert_equal 404, miss["status"]
  end

  def test_optional_param
    app = Homura.new
    app.get("/api/:version?") { |ctx| ctx.json({ version: ctx.req.param(:version) }) }

    with = app.call(build_env("GET", "/api/v2"))
    assert_equal 200, with["status"]
    assert_equal "v2", with["body"][:version]

    without = app.call(build_env("GET", "/api"))
    assert_equal 200, without["status"]
    assert_nil without["body"][:version]
  end

  def test_route_sub_app
    sub = Homura.new
    sub.get("/") { |ctx| ctx.text("sub-root") }
    sub.get("/:id") { |ctx| ctx.text("sub-#{ctx.req.param(:id)}") }

    app = Homura.new
    app.route("/api", sub)

    root = app.call(build_env("GET", "/api"))
    assert_equal 200, root["status"]
    assert_equal "sub-root", root["body"]

    item = app.call(build_env("GET", "/api/42"))
    assert_equal 200, item["status"]
    assert_equal "sub-42", item["body"]
  end

  def test_base_path
    app = Homura.new
    app.base_path("/v1")
    app.get("/users") { |ctx| ctx.text("users") }

    hit = app.call(build_env("GET", "/v1/users"))
    assert_equal 200, hit["status"]
    assert_equal "users", hit["body"]

    miss = app.call(build_env("GET", "/users"))
    assert_equal 404, miss["status"]
  end

  # === Phase 6: Context API ===

  def test_context_set_and_get
    app = Homura.new
    app.use do |ctx, nxt|
      ctx.set("user_id", 42)
      nxt.call
    end
    app.get("/me") { |ctx| ctx.json({ user_id: ctx.get("user_id") }) }

    result = app.call(build_env("GET", "/me"))
    assert_equal 200, result["status"]
    assert_equal 42, result["body"][:user_id]
  end

  def test_context_body_response
    app = Homura.new
    app.get("/raw") { |ctx| ctx.body("raw data", status: 201, headers: { "X-Custom" => "yes" }) }

    result = app.call(build_env("GET", "/raw"))
    assert_equal 201, result["status"]
    assert_equal "raw data", result["body"]
    assert_equal "yes", result["headers"]["X-Custom"]
  end

  def test_context_not_found
    app = Homura.new
    app.get("/check") { |ctx| ctx.not_found }

    result = app.call(build_env("GET", "/check"))
    assert_equal 404, result["status"]
    assert_equal "Not Found", result["body"]
  end

  def test_req_url
    app = Homura.new
    app.get("/info") { |ctx| ctx.text(ctx.req.url) }

    env = build_env("GET", "/info")
    env[:request][:url] = "https://example.com/info?q=1"
    result = app.call(env)
    assert_equal 200, result["status"]
    assert_equal "https://example.com/info?q=1", result["body"]
  end

  def test_req_queries
    app = Homura.new
    app.get("/search") { |ctx| ctx.json({ tags: ctx.req.queries("tag") }) }

    env = build_env("GET", "/search", query: { "tag" => ["ruby", "wasm"] })
    result = app.call(env)
    assert_equal 200, result["status"]
    assert_equal ["ruby", "wasm"], result["body"][:tags]
  end

  def test_req_queries_single_value
    app = Homura.new
    app.get("/search") { |ctx| ctx.json({ tags: ctx.req.queries("tag") }) }

    env = build_env("GET", "/search", query: { "tag" => "ruby" })
    result = app.call(env)
    assert_equal 200, result["status"]
    assert_equal ["ruby"], result["body"][:tags]
  end

  # === Phase 7: Built-in Middleware ===

  def test_cors_middleware
    app = Homura.new
    app.use(&Homura::Middleware.cors(origin: "https://example.com"))
    app.get("/data") { |ctx| ctx.json({ ok: true }) }

    get_result = app.call(build_env("GET", "/data"))
    assert_equal 200, get_result["status"]
    assert_equal "https://example.com", get_result["headers"]["Access-Control-Allow-Origin"]

    opts_result = app.call(build_env("OPTIONS", "/data"))
    assert_equal 204, opts_result["status"]
    assert_includes opts_result["headers"]["Access-Control-Allow-Methods"], "GET"
  end

  def test_logger_middleware
    logs = []
    app = Homura.new
    app.use(&Homura::Middleware.logger(output: ->(msg) { logs << msg }))
    app.get("/log") { |ctx| ctx.text("ok") }

    app.call(build_env("GET", "/log"))
    assert_equal 1, logs.length
    assert_match(/GET \/log 200/, logs[0])
  end

  def test_basic_auth_middleware
    app = Homura.new
    app.use(&Homura::Middleware.basic_auth(username: "admin", password: "secret"))
    app.get("/secure") { |ctx| ctx.text("ok") }

    no_auth = app.call(build_env("GET", "/secure"))
    assert_equal 401, no_auth["status"]

    encoded = Homura::Middleware.base64_decode("YWRtaW46c2VjcmV0") # "admin:secret"
    assert_equal "admin:secret", encoded

    good_auth = app.call(build_env("GET", "/secure", headers: { "Authorization" => "Basic YWRtaW46c2VjcmV0" }))
    assert_equal 200, good_auth["status"]
    assert_equal "ok", good_auth["body"]
  end

  def test_bearer_auth_middleware
    app = Homura.new
    app.use(&Homura::Middleware.bearer_auth(token: "my-token-123"))
    app.get("/api") { |ctx| ctx.text("ok") }

    no_auth = app.call(build_env("GET", "/api"))
    assert_equal 401, no_auth["status"]

    good = app.call(build_env("GET", "/api", headers: { "Authorization" => "Bearer my-token-123" }))
    assert_equal 200, good["status"]

    bad = app.call(build_env("GET", "/api", headers: { "Authorization" => "Bearer wrong" }))
    assert_equal 401, bad["status"]
  end

  def test_powered_by_middleware
    app = Homura.new
    app.use(&Homura::Middleware.powered_by("HomuraRb"))
    app.get("/") { |ctx| ctx.text("ok") }

    result = app.call(build_env("GET", "/"))
    assert_equal "HomuraRb", result["headers"]["X-Powered-By"]
  end

  def test_secure_headers_middleware
    app = Homura.new
    app.use(&Homura::Middleware.secure_headers)
    app.get("/") { |ctx| ctx.text("ok") }

    result = app.call(build_env("GET", "/"))
    assert_equal "nosniff", result["headers"]["X-Content-Type-Options"]
    assert_equal "SAMEORIGIN", result["headers"]["X-Frame-Options"]
    assert_equal "0", result["headers"]["X-XSS-Protection"]
  end

  def test_request_id_middleware
    app = Homura.new
    app.use(&Homura::Middleware.request_id)
    app.get("/") { |ctx| ctx.text(ctx.get("request_id")) }

    result = app.call(build_env("GET", "/"))
    assert_equal 200, result["status"]
    refute_nil result["headers"]["X-Request-Id"]
    assert_equal result["headers"]["X-Request-Id"], result["body"]
  end

  def test_request_id_forwards_existing
    app = Homura.new
    app.use(&Homura::Middleware.request_id)
    app.get("/") { |ctx| ctx.text(ctx.get("request_id")) }

    result = app.call(build_env("GET", "/", headers: { "X-Request-Id" => "abc-123" }))
    assert_equal "abc-123", result["body"]
    assert_equal "abc-123", result["headers"]["X-Request-Id"]
  end

  def test_etag_middleware
    app = Homura.new
    app.use(&Homura::Middleware.etag)
    app.get("/") { |ctx| ctx.text("hello world") }

    result = app.call(build_env("GET", "/"))
    assert_equal 200, result["status"]
    etag = result["headers"]["ETag"]
    refute_nil etag

    cached = app.call(build_env("GET", "/", headers: { "If-None-Match" => etag }))
    assert_equal 304, cached["status"]
  end

  def test_body_limit_middleware
    app = Homura.new
    app.use(&Homura::Middleware.body_limit(max_size: 10))
    app.post("/upload") { |ctx| ctx.text("ok") }

    small = app.call(build_env("POST", "/upload", body: "short"))
    assert_equal 200, small["status"]

    big = app.call(build_env("POST", "/upload", body: "x" * 20))
    assert_equal 413, big["status"]
  end

  # === Phase 8: Cookie & Helpers ===

  def test_cookie_get
    app = Homura.new
    app.get("/me") { |ctx| ctx.text(ctx.cookie("session") || "none") }

    result = app.call(build_env("GET", "/me", headers: { "Cookie" => "session=abc123; theme=dark" }))
    assert_equal 200, result["status"]
    assert_equal "abc123", result["body"]
  end

  def test_set_cookie
    app = Homura.new
    app.get("/login") do |ctx|
      ctx.set_cookie("session", "xyz", http_only: true, secure: true, path: "/")
      ctx.text("ok")
    end

    result = app.call(build_env("GET", "/login"))
    assert_equal 200, result["status"]
    sc = result["headers"]["Set-Cookie"]
    assert_includes sc, "session=xyz"
    assert_includes sc, "HttpOnly"
    assert_includes sc, "Secure"
    assert_includes sc, "Path=/"
  end

  def test_delete_cookie
    app = Homura.new
    app.get("/logout") do |ctx|
      ctx.delete_cookie("session")
      ctx.text("ok")
    end

    result = app.call(build_env("GET", "/logout"))
    sc = result["headers"]["Set-Cookie"]
    assert_includes sc, "session="
    assert_includes sc, "Max-Age=0"
  end

  def test_app_request_helper
    app = Homura.new
    app.get("/hello") { |ctx| ctx.text("world") }
    app.post("/echo") { |ctx| ctx.json(ctx.json_body) }

    get_result = app.request("GET", "/hello")
    assert_equal 200, get_result["status"]
    assert_equal "world", get_result["body"]

    post_result = app.request("POST", "/echo", body: '{"msg":"hi"}', headers: { "Content-Type" => "application/json" })
    assert_equal 200, post_result["status"]
    assert_equal "hi", post_result["body"]["msg"]
  end

  def test_view_tag_helper
    html = View.tag("div", class: "box") { "Hello" }
    assert_equal '<div class="box">Hello</div>', html

    br = View.tag("br")
    assert_equal "<br />", br

    input = View.tag("input", type: "text", disabled: true)
    assert_equal '<input type="text" disabled />', input
  end

  # === Phase 9: Advanced Routing ===

  def test_regex_param_route
    app = Homura.new
    app.get("/post/:date{[0-9]+}/:slug") { |ctx| ctx.json({ date: ctx.req.param(:date), slug: ctx.req.param(:slug) }) }

    hit = app.call(build_env("GET", "/post/20260306/hello-world"))
    assert_equal 200, hit["status"]
    assert_equal "20260306", hit["body"][:date]
    assert_equal "hello-world", hit["body"][:slug]

    miss = app.call(build_env("GET", "/post/not-a-date/slug"))
    assert_equal 404, miss["status"]
  end

  def test_mount_app
    api = Homura.new
    api.get("/users") { |ctx| ctx.json({ users: [] }) }

    app = Homura.new
    app.mount("/v2", api)

    hit = app.call(build_env("GET", "/v2/users"))
    assert_equal 200, hit["status"]
    assert_equal({ users: [] }, hit["body"])

    miss = app.call(build_env("GET", "/v3/users"))
    assert_equal 404, miss["status"]
  end

  # === Phase 10: Context API 仕上げ ===

  def test_new_response
    app = Homura.new
    app.get("/raw") { |ctx| ctx.new_response("custom", 201, { "X-Custom" => "yes" }) }

    result = app.call(build_env("GET", "/raw"))
    assert_equal 201, result["status"]
    assert_equal "custom", result["body"]
    assert_equal "yes", result["headers"]["X-Custom"]
  end

  def test_header_append_mode
    app = Homura.new
    app.get("/multi") do |ctx|
      ctx.header("X-Multi", "a")
      ctx.header("X-Multi", "b", append: true)
      ctx.text("ok")
    end

    result = app.call(build_env("GET", "/multi"))
    assert_equal "a, b", result["headers"]["X-Multi"]
  end

  def test_set_renderer_and_render
    app = Homura.new
    app.use do |ctx, nxt|
      ctx.set_renderer do |content, *args|
        title = args[0] || "Default"
        ctx.html("<html><head><title>#{title}</title></head><body>#{content}</body></html>")
      end
      nxt.call
    end
    app.get("/page") { |ctx| ctx.render("<h1>Hello</h1>", "My Page") }

    result = app.call(build_env("GET", "/page"))
    assert_equal 200, result["status"]
    assert_includes result["body"], "<title>My Page</title>"
    assert_includes result["body"], "<h1>Hello</h1>"
  end

  def test_render_without_renderer_falls_back_to_html
    app = Homura.new
    app.get("/page") { |ctx| ctx.render("<h1>Simple</h1>") }

    result = app.call(build_env("GET", "/page"))
    assert_equal 200, result["status"]
    assert_equal "<h1>Simple</h1>", result["body"]
    assert_equal "text/html", result["headers"]["Content-Type"]
  end

  # === Phase 11: Request API 仕上げ ===

  def test_parse_body_urlencoded
    app = Homura.new
    app.post("/form") { |ctx| ctx.json(ctx.req.parse_body) }

    result = app.call(build_env("POST", "/form",
      body: "name=Alice&age=30&city=Tokyo",
      headers: { "Content-Type" => "application/x-www-form-urlencoded" }
    ))
    assert_equal 200, result["status"]
    assert_equal "Alice", result["body"]["name"]
    assert_equal "30", result["body"]["age"]
    assert_equal "Tokyo", result["body"]["city"]
  end

  def test_parse_body_url_decode
    app = Homura.new
    app.post("/form") { |ctx| ctx.json(ctx.req.parse_body) }

    result = app.call(build_env("POST", "/form",
      body: "name=Hello+World&q=%E3%81%82",
      headers: { "Content-Type" => "application/x-www-form-urlencoded" }
    ))
    assert_equal "Hello World", result["body"]["name"]
  end

  def test_valid_and_add_validated_data
    app = Homura.new
    app.use do |ctx, nxt|
      ctx.req.add_validated_data("json", { "name" => "Alice" })
      nxt.call
    end
    app.get("/data") { |ctx| ctx.json({ name: ctx.req.valid("json")["name"] }) }

    result = app.call(build_env("GET", "/data"))
    assert_equal "Alice", result["body"][:name]
  end

  def test_route_path
    app = Homura.new
    app.get("/users/:id") { |ctx| ctx.text(ctx.req.route_path) }

    result = app.call(build_env("GET", "/users/42"))
    assert_equal "/users/:id", result["body"]
  end

  # === Phase 12: HTTPException ===

  def test_http_exception_basic
    app = Homura.new
    app.get("/auth") { raise HTTPException.new(401, message: "Login required") }

    result = app.call(build_env("GET", "/auth"))
    assert_equal 401, result["status"]
    assert_equal "Login required", result["body"]
  end

  def test_http_exception_with_custom_response
    app = Homura.new
    app.get("/custom") do
      raise HTTPException.new(403, res: {
        status: 403,
        body: { error: "forbidden", code: "NO_ACCESS" },
        headers: { "Content-Type" => "application/json" },
      })
    end

    result = app.call(build_env("GET", "/custom"))
    assert_equal 403, result["status"]
    assert_equal "NO_ACCESS", result["body"][:code]
  end

  def test_http_exception_with_on_error
    app = Homura.new
    app.get("/fail") { raise HTTPException.new(422, message: "Bad data") }
    app.on_error do |err, ctx|
      if err.is_a?(HTTPException)
        err.get_response
      else
        { status: 500, body: "error" }
      end
    end

    result = app.call(build_env("GET", "/fail"))
    assert_equal 422, result["status"]
    assert_equal "Bad data", result["body"]
  end

  def test_http_exception_default_message
    ex = HTTPException.new(404)
    assert_equal "Not Found", ex.message
    assert_equal 404, ex.status
  end

  def test_http_exception_cause
    original = RuntimeError.new("db error")
    ex = HTTPException.new(500, message: "Server Error", cause: original)
    assert_equal original, ex.cause
  end

  # === Phase 13: CSRF, IP Restriction, Timing ===

  def test_csrf_blocks_cross_origin
    app = Homura.new
    app.use(&Homura::Middleware.csrf(origin: "https://example.com"))
    app.post("/submit") { |ctx| ctx.text("ok") }

    good = app.call(build_env("POST", "/submit", headers: { "Origin" => "https://example.com" }))
    assert_equal 200, good["status"]

    bad = app.call(build_env("POST", "/submit", headers: { "Origin" => "https://evil.com" }))
    assert_equal 403, bad["status"]
  end

  def test_csrf_allows_get
    app = Homura.new
    app.use(&Homura::Middleware.csrf(origin: "https://example.com"))
    app.get("/data") { |ctx| ctx.text("ok") }

    result = app.call(build_env("GET", "/data", headers: { "Origin" => "https://evil.com" }))
    assert_equal 200, result["status"]
  end

  def test_ip_restriction_allow_list
    app = Homura.new
    app.use(&Homura::Middleware.ip_restriction(allow_list: ["192.168.1.1"]))
    app.get("/") { |ctx| ctx.text("ok") }

    good = app.call(build_env("GET", "/", headers: { "X-Forwarded-For" => "192.168.1.1" }))
    assert_equal 200, good["status"]

    bad = app.call(build_env("GET", "/", headers: { "X-Forwarded-For" => "10.0.0.1" }))
    assert_equal 403, bad["status"]
  end

  def test_ip_restriction_deny_list
    app = Homura.new
    app.use(&Homura::Middleware.ip_restriction(deny_list: ["10.0.0.1"]))
    app.get("/") { |ctx| ctx.text("ok") }

    good = app.call(build_env("GET", "/", headers: { "X-Forwarded-For" => "192.168.1.1" }))
    assert_equal 200, good["status"]

    bad = app.call(build_env("GET", "/", headers: { "X-Forwarded-For" => "10.0.0.1" }))
    assert_equal 403, bad["status"]
  end

  def test_timing_middleware
    app = Homura.new
    app.use(&Homura::Middleware.timing)
    app.get("/slow") do |ctx|
      Homura::Middleware.set_metric(ctx, "db", 5.2, "Database Query")
      ctx.text("ok")
    end

    result = app.call(build_env("GET", "/slow"))
    assert_equal 200, result["status"]
    timing = result["headers"]["Server-Timing"]
    refute_nil timing
    assert_includes timing, "db;dur=5.2"
    assert_includes timing, "total;dur="
  end

  def test_timing_start_end
    app = Homura.new
    app.use(&Homura::Middleware.timing)
    app.get("/") do |ctx|
      Homura::Middleware.start_time(ctx, "process")
      Homura::Middleware.end_time(ctx, "process")
      ctx.text("ok")
    end

    result = app.call(build_env("GET", "/"))
    timing = result["headers"]["Server-Timing"]
    assert_includes timing, "process;dur="
  end

  # === Phase 14: API 互換 ===

  def test_fetch_alias
    app = Homura.new
    app.get("/") { |ctx| ctx.text("hello") }

    result = app.fetch(build_env("GET", "/"))
    assert_equal 200, result["status"]
    assert_equal "hello", result["body"]
  end

  def test_not_found_alias
    app = Homura.new
    app.notFound { |ctx| ctx.text("custom 404", status: 404) }

    result = app.call(build_env("GET", "/missing"))
    assert_equal 404, result["status"]
    assert_equal "custom 404", result["body"]
  end

  def test_on_error_alias
    app = Homura.new
    app.get("/err") { raise "boom" }
    app.onError { |err| { status: 500, body: "caught: #{err.message}" } }

    result = app.call(build_env("GET", "/err"))
    assert_equal 500, result["status"]
    assert_equal "caught: boom", result["body"]
  end

  def test_strict_mode_default
    app = Homura.new
    app.get("/hello") { |ctx| ctx.text("ok") }

    exact = app.call(build_env("GET", "/hello"))
    assert_equal 200, exact["status"]

    trailing = app.call(build_env("GET", "/hello/"))
    assert_equal 404, trailing["status"]
  end

  def test_non_strict_mode
    app = Homura.new(strict: false)
    app.get("/hello") { |ctx| ctx.text("ok") }

    exact = app.call(build_env("GET", "/hello"))
    assert_equal 200, exact["status"]

    trailing = app.call(build_env("GET", "/hello/"))
    assert_equal 200, trailing["status"]
  end

  # === End Phase 14 ===

  def test_d1_result_order_mismatch_is_rejected
    app = Homura.new
    app.get("/todos") do |ctx|
      ctx.json(ctx.db.get("SELECT * FROM todos WHERE id = ?", [1]))
    end

    result = app.call(
      build_env(
        "GET",
        "/todos",
        control: {
          continue: true,
          ops: [
            {
              "kind" => "d1",
              "op" => "run",
              "ok" => true,
              "result" => { "meta" => { "changes" => 1 } },
            },
          ],
        },
      ),
    )

    assert_equal 500, result["status"]
    assert_match(/Unexpected D1 result order/, result["body"]["error"])
    assert_equal "RuntimeError", result["headers"]["X-Homura-Error"]
  end
end
