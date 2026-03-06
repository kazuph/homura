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
