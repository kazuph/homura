# frozen_string_literal: true

require "minitest/autorun"

require_relative "../lib/homura"

class HomuraCoreTest < Minitest::Test
  def build_env(method, path)
    {
      request: {
        method: method,
        path: path,
        query: {},
        headers: {},
        body: "",
        content_type: "",
        kv_data: {},
      },
      control: { continue: false },
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
    assert_equal ({ "method" => "GET", "id" => "42" }), result["body"]
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
end
