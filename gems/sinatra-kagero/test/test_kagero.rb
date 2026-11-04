# frozen_string_literal: true

require "minitest/autorun"
require "rack/test"
require "json"
require "sinatra/base"

$LOAD_PATH.unshift(File.expand_path("../lib", __dir__))
require "sinatra/kagero"

module Pages
  class TodosIndex < Kagero::Page
    title "Todos"

    props do
      prop :todos, Array
      prop :notice, String, required: false, default: ""
    end

    def view_template
      section do
        h1 { "Todos" }
        p(class: "notice") { @notice } unless @notice.empty?
        kagero_form(action: "/todos", method: "post") do
          input(type: "text", name: "title")
          button(type: "submit") { "Add" }
        end

        ul do
          @todos.each do |todo|
            li { todo.fetch(:title) }
          end
        end
      end
    end
  end
end

def make_kagero_app(version: "1", csrf: false, &routes)
  Class.new(Sinatra::Base) do
    set(:host_authorization, permitted_hosts: [])
    set(:protection, except: %i[remote_token session_hijacking http_origin])
    set(:inertia_csrf_protection, csrf)
    register(Sinatra::Kagero)
    set(:page_version, version)
    instance_exec(&routes)
  end
end

class KageroTest < Minitest::Test
  include Rack::Test::Methods

  def app
    @app
  end

  def test_initial_get_returns_shell_with_ruby_page_html_and_page_object
    @app = make_kagero_app do
      get("/") { page(Pages::TodosIndex, todos: [{title: "Ship Kagero"}]) }
    end

    get("/")
    assert_equal(200, last_response.status)
    assert_includes(last_response.body, "<title>Todos</title>")
    assert_includes(last_response.body, "<h1>Todos</h1>")
    assert_includes(last_response.body, "Ship Kagero")
    assert_includes(last_response.body, "data-kagero-root")
    assert_includes(last_response.body, "data-kagero=\"true\"")
    assert_includes(last_response.body, "&quot;component&quot;:&quot;TodosIndex&quot;")
    assert_includes(last_response.body, "window.Kagero")
  end

  def test_inertia_visit_returns_json_page_object_with_kagero_html
    @app = make_kagero_app do
      get("/") { page(Pages::TodosIndex, todos: [{title: "JSON page"}]) }
    end

    header("X-Inertia", "true")
    header("X-Inertia-Version", "1")
    get("/")

    assert_equal(200, last_response.status)
    assert_equal("true", last_response.headers["X-Inertia"])
    payload = JSON.parse(last_response.body)
    assert_equal("TodosIndex", payload["component"])
    assert_equal([{"title" => "JSON page"}], payload.dig("props", "todos"))
    assert_includes(payload.dig("props", "kagero", "html"), "JSON page")
    assert_equal("Todos", payload.dig("props", "kagero", "title"))
  end

  def test_redirect_page_returns_next_page_object_for_inertia_posts
    @app = make_kagero_app do
      post("/todos") do
        redirect_page("/", Pages::TodosIndex, todos: [{title: "Created"}], notice: "Saved")
      end
    end

    header("X-Inertia", "true")
    header("X-Inertia-Version", "1")
    post("/todos", title: "Created")

    assert_equal(200, last_response.status)
    assert_equal("true", last_response.headers["X-Inertia"])
    payload = JSON.parse(last_response.body)
    assert_equal("/", payload["url"])
    assert_equal("Saved", payload.dig("props", "notice"))
    assert_includes(payload.dig("props", "kagero", "html"), "Created")
  end

  def test_partial_only_and_except_always_return_kagero_html
    @app = make_kagero_app do
      get("/") { page(Pages::TodosIndex, todos: [{title: "Partial"}], notice: "Notice") }
    end

    header("X-Inertia", "true")
    header("X-Inertia-Version", "1")
    header("X-Inertia-Partial-Component", "TodosIndex")
    header("X-Inertia-Partial-Data", "notice")
    get("/")
    props = JSON.parse(last_response.body).fetch("props")
    assert_equal("Notice", props["notice"])
    refute(props.key?("todos"))
    assert_includes(props.dig("kagero", "html"), "Partial")
    header("X-Inertia-Partial-Data", nil)
    header("X-Inertia-Partial-Except", "todos")
    get("/")
    props = JSON.parse(last_response.body).fetch("props")
    refute(props.key?("todos"))
    assert_includes(props.dig("kagero", "html"), "Partial")
  end

  def test_runtime_source_matches_javascript_file
    assert_equal(
      File.read(File.expand_path("../runtime/kagero.js", __dir__), encoding: "UTF-8"),
      Sinatra::Kagero::Runtime::SOURCE
    )
  end

  def test_first_inertia_get_returns_headers_and_csrf_cookie
    @app = make_kagero_app(csrf: true) do
      get("/") { page(Pages::TodosIndex, todos: []) }
    end

    header("X-Inertia", "true")
    header("X-Inertia-Version", "1")
    get("/")
    assert_equal(200, last_response.status)
    assert_equal("true", last_response.headers["X-Inertia"])
    assert_match(/XSRF-TOKEN=/, last_response.headers["Set-Cookie"])
  end

  def test_csrf_requires_matching_header
    @app = make_kagero_app(csrf: true) do
      get("/") { "ok" }
      post("/") { "ok" }
    end

    get("/")
    token = rack_mock_session.cookie_jar["XSRF-TOKEN"]
    refute_nil(token)
    post("/")
    assert_equal(403, last_response.status)
    header("X-XSRF-TOKEN", "incorrect")
    post("/")
    assert_equal(403, last_response.status)
    header("X-XSRF-TOKEN", token)
    post("/")
    assert_equal(200, last_response.status)
  end

  def test_page_props_validate_required_values
    error = assert_raises(Sinatra::Kagero::Props::ValidationError) do
      Pages::TodosIndex.new
    end

    assert_equal({todos: "is required"}, error.errors)
  end

  def test_page_props_validate_type
    error = assert_raises(Sinatra::Kagero::Props::ValidationError) do
      Pages::TodosIndex.new(todos: "nope")
    end

    assert_equal({todos: "must be Array"}, error.errors)
  end

  def test_command_validates_ruby_form_input
    command_class = Class.new(Sinatra::Kagero::Command) do
      attribute(:title, String, default: "")
      validates_presence_of(:title, message: "title required")
      validates_length_of(:title, maximum: 5)
    end

    blank = command_class.new("title" => " ")
    assert_equal(false, blank.valid?)
    assert_equal({title: "title required"}, blank.errors)

    long = command_class.new(title: "abcdef")
    assert_equal(false, long.valid?)
    assert_equal({title: "must be 5 characters or less"}, long.errors)

    valid = command_class.new(title: "ship")
    assert_equal(true, valid.valid?)
    assert_equal({title: "ship"}, valid.to_h)
  end
end
