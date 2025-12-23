# Homura - Ruby DSL for Edge Computing
#
# This file defines your application routes using Homura's DSL.
# Inspired by Sinatra/Hono, but designed for edge computing.

class Homura
  attr_reader :routes, :middlewares

  def initialize
    @routes = {}
    @middlewares = []
  end

  # Route definitions
  def get(path, &block)
    add_route("GET", path, &block)
  end

  def post(path, &block)
    add_route("POST", path, &block)
  end

  def put(path, &block)
    add_route("PUT", path, &block)
  end

  def delete(path, &block)
    add_route("DELETE", path, &block)
  end

  def options(path, &block)
    add_route("OPTIONS", path, &block)
  end

  # Middleware
  def use(middleware)
    @middlewares << middleware
  end

  # Request handling
  def call(env)
    method = env[:method]
    path = env[:path]

    # Find matching route
    handler = find_route(method, path)

    if handler
      # Execute middlewares then handler
      context = Context.new(env)
      @middlewares.each { |m| m.call(context) }
      handler[:block].call(context, handler[:params])
    else
      { status: 404, body: "Not Found", headers: {} }
    end
  end

  private

  def add_route(method, path, &block)
    pattern = path_to_pattern(path)
    @routes[[method, pattern]] = { block: block, path: path }
  end

  def find_route(method, path)
    @routes.each do |(route_method, pattern), handler|
      next unless route_method == method

      if params = match_path(pattern, path)
        return { block: handler[:block], params: params }
      end
    end
    nil
  end

  def path_to_pattern(path)
    # Convert :param to regex capture groups
    pattern = path.gsub(/:(\w+)/, '(?<\1>[^/]+)')
    Regexp.new("^#{pattern}$")
  end

  def match_path(pattern, path)
    match = pattern.match(path)
    return nil unless match

    # Extract named captures as params
    params = {}
    match.names.each { |name| params[name.to_sym] = match[name] }
    params
  end
end

# Context object passed to handlers
class Context
  attr_reader :env, :request, :response_headers

  def initialize(env)
    @env = env
    @request = Request.new(env)
    @response_headers = { "Content-Type" => "text/plain" }
  end

  def json(data, status: 200)
    @response_headers["Content-Type"] = "application/json"
    { status: status, body: data.to_json, headers: @response_headers }
  end

  def text(body, status: 200)
    { status: status, body: body, headers: @response_headers }
  end

  def html(body, status: 200)
    @response_headers["Content-Type"] = "text/html"
    { status: status, body: body, headers: @response_headers }
  end

  def redirect(url, status: 302)
    { status: status, body: "", headers: { "Location" => url } }
  end

  def header(name, value)
    @response_headers[name] = value
  end
end

# Request wrapper
class Request
  attr_reader :method, :path, :query, :headers, :body

  def initialize(env)
    @method = env[:method]
    @path = env[:path]
    @query = env[:query] || {}
    @headers = env[:headers] || {}
    @body = env[:body]
  end

  def param(name)
    @query[name.to_s] || @query[name.to_sym]
  end
end

# ====================================
# Application Routes
# ====================================

app = Homura.new

# Basic routes
app.get "/" do |c|
  c.json({ message: "Hello from Homura!", framework: "mruby + WASI" })
end

app.get "/about" do |c|
  c.text("Homura - A Ruby DSL for Cloudflare Workers")
end

# Route with parameters
app.get "/users/:id" do |c, params|
  c.json({ user_id: params[:id], action: "show" })
end

app.get "/posts/:year/:month/:slug" do |c, params|
  c.json({
    year: params[:year],
    month: params[:month],
    slug: params[:slug]
  })
end

# JSON API example
app.post "/api/echo" do |c|
  c.json({ received: c.request.body, timestamp: Time.now.to_i })
end

# HTML response
app.get "/hello/:name" do |c, params|
  c.html("<h1>Hello, #{params[:name]}!</h1>")
end

# Export the app
app
