# Homura - A Hono-like Ruby DSL for Cloudflare Workers
# This file is the framework core - users don't need to modify this

class ContinueRequest < StandardError
  attr_reader :context

  def initialize(context)
    @context = context
    super("Homura request requires continuation")
  end
end

class Homura
  VERSION = 2

  def initialize
    @routes = {}
    @not_found = nil
    @method_not_allowed = nil
    @on_error = nil
    @middleware = []
    @route_middleware = Hash.new { |h, k| h[k] = [] }
    @after = []
    @route_after = Hash.new { |h, k| h[k] = [] }
  end

  # Middleware registration: use { |ctx, nxt| nxt.call }
  # - Global: use { ... }
  # - Route scoped: use "/users/:id" { ... }
  def use(*args, &block)
    raise ArgumentError, 'use requires a block' unless block_given?

    if args.empty?
      @middleware << block
      return
    end

    if args.length == 1 && args[0].is_a?(String)
      @route_middleware[["ALL", args[0]]] << block
      return
    end

    raise ArgumentError, 'use first arg must be a route path string or omitted'
  end

  def after(*args, &block)
    raise ArgumentError, 'after requires a block' unless block_given?

    if args.empty?
      @after << block
      return
    end

    if args.length == 1 && args[0].is_a?(String)
      @route_after[["ALL", args[0]]] << block
      return
    end

    raise ArgumentError, 'after first arg must be a route path string or omitted'
  end

  def on_error(&block)
    raise ArgumentError, 'on_error requires a block' unless block_given?
    @on_error = block
  end

  def get(path, *middlewares, &block)
    raise ArgumentError, 'route block required' unless block_given?
    @routes[["GET", path]] = {
      handler: block,
      middleware: middlewares,
    }
    self
  end

  def post(path, *middlewares, &block)
    raise ArgumentError, 'route block required' unless block_given?
    @routes[["POST", path]] = {
      handler: block,
      middleware: middlewares,
    }
    self
  end

  def put(path, *middlewares, &block)
    raise ArgumentError, 'route block required' unless block_given?
    @routes[["PUT", path]] = {
      handler: block,
      middleware: middlewares,
    }
    self
  end

  def patch(path, *middlewares, &block)
    raise ArgumentError, 'route block required' unless block_given?
    @routes[["PATCH", path]] = {
      handler: block,
      middleware: middlewares,
    }
    self
  end

  def delete(path, *middlewares, &block)
    raise ArgumentError, 'route block required' unless block_given?
    @routes[["DELETE", path]] = {
      handler: block,
      middleware: middlewares,
    }
    self
  end

  def match_route(method, path)
    @routes.each do |(route_method, pattern), route|
      next unless route_method == method
      params = match_path(pattern, path)
      next unless params

      handler = nil
      route_middleware = []

      if route.is_a?(Hash)
        handler = route[:handler] || route["handler"]
        route_middleware = route[:middleware] || route["middleware"] || []
      elsif route.respond_to?(:call)
        handler = route
      end

      next unless handler
      return [handler, route_middleware, params, pattern]
    end
    nil
  end

  def match_route_for_methods(path)
    found = []
    @routes.each do |(route_method, pattern), _|
      params = match_path(pattern, path)
      next unless params
      found << [route_method, pattern, params]
    end
    found
  end

  def call(raw_env)
    env = normalize_env(raw_env)
    method = env[:method] || ""
    path = env[:path] || "/"
    request = create_context(env, {})
    after_callbacks = @after

    begin
      matched = match_route(method, path)

      response = if matched
        handler, route_middleware, params, pattern = matched
        request = create_context(env, params)
        after_callbacks = collect_after(method, pattern)
        run_request_pipeline(request, method, path, pattern, handler, route_middleware, after_callbacks)
      else
        alternatives = match_route_for_methods(path)
        if !alternatives.empty?
          run_method_not_allowed(request, alternatives)
        elsif @not_found
          request = create_context(env, {})
          run_not_found(request)
        else
          { status: 404, body: "Not Found", headers: {} }
        end
      end

      with_protocol_version(response)
    rescue ContinueRequest => e
      handle_continue_request(e.context || request)
    rescue => e
      handle_error(e, request, after_callbacks)
    end
  end

  def call_with_rescue(raw_env)
    call(raw_env)
  rescue ContinueRequest => e
    handle_continue_request(e.context || create_context(normalize_env(raw_env), {}))
  rescue => e
    handle_error(e, create_context(normalize_env(raw_env), {}))
  end

  def not_found(&block)
    @not_found = block
  end

  def run_not_found(request)
    response = run_middleware(request, @middleware, lambda {
      call_handler(@not_found, request)
    })
    response = run_after(request, response, @after)
    attach_loop_ops(request, response)
  end

  def method_not_allowed(&block)
    @method_not_allowed = block
  end

  def normalize_env(raw_env)
    raw = raw_env.is_a?(Hash) ? raw_env : {}
    request_env = if raw.key?(:request)
      raw[:request]
    elsif raw.key?("request")
      raw["request"]
    else
      raw
    end

    {
      method: fetch_env_value(request_env, :method, ""),
      path: fetch_env_value(request_env, :path, "/"),
      query: fetch_env_value(request_env, :query, {}),
      headers: fetch_env_value(request_env, :headers, {}),
      body: fetch_env_value(request_env, :body, ""),
      content_type: fetch_env_value(request_env, :content_type, ""),
      kv_data: fetch_env_value(request_env, :kv_data, {}),
      control: fetch_env_value(raw, :control, {}),
    }
  end

  def fetch_env_value(env, key, default = nil)
    return default if env.nil? || !env.is_a?(Hash)
    return env[key] if env.key?(key)
    return env[key.to_s] if env.key?(key.to_s)
    default
  end

  def with_protocol_version(response)
    return {
      "v" => VERSION,
      "status" => 500,
      "body" => "Internal Server Error",
      "headers" => { "Content-Type" => "text/plain" },
    } unless response.is_a?(Hash)

    normalized = {}
    response.each do |k, v|
      next if k.nil?
      normalized[k.to_s] = v
    end

    status = parse_status(response)
    status = 500 unless status.between?(100, 599)
    normalized["status"] = status
    normalized["body"] = "" if normalized["body"].nil?
    normalized["headers"] ||= {}
    normalized["v"] = VERSION
    normalized
  end

  private

  def create_context(env, params)
    Context.new(env, params)
  end

  def match_path(pattern, path)
    path_parts = path.split("/").reject { |p| p.empty? }
    pattern_parts = pattern.split("/").reject { |p| p.empty? }
    return nil unless pattern_parts.length == path_parts.length

    params = {}

    pattern_parts.each_with_index do |part, idx|
      if part.start_with?(":")
        params[part[1..-1].to_sym] = path_parts[idx]
      elsif part != path_parts[idx]
        return nil
      end
    end

    params
  end

  def collect_middleware(method, pattern, route_middleware)
    middlewares = []
    middlewares.concat(@middleware)
    middlewares.concat(route_middleware || [])
    middlewares.concat(@route_middleware[["ALL", pattern]] || [])
    middlewares.concat(@route_middleware[[method, pattern]] || [])
    middlewares
  end

  def collect_after(method, pattern)
    afters = []
    afters.concat(@after)
    afters.concat(@route_after[["ALL", pattern]] || [])
    afters.concat(@route_after[[method, pattern]] || [])
    afters
  end

  def run_request_pipeline(request, method, path, pattern, handler, route_middleware, after_callbacks)
    response = run_middleware(request, collect_middleware(method, pattern, route_middleware), lambda {
      call_handler(handler, request)
    })
    response = run_after(request, response, after_callbacks)
    attach_loop_ops(request, response)
  end

  def attach_loop_ops(request, response)
    return response unless response.is_a?(Hash)

    if response.is_a?(Hash) && request.kv_ops && !request.kv_ops.empty?
      response["kv_ops"] = request.kv_ops
    end
    if request.d1_ops && !request.d1_ops.empty?
      response["d1_ops"] = request.d1_ops.map do |op|
        next unless op.is_a?(Hash)
        next_op = {}
        op.each do |key, value|
          next_op[key.to_s] = value
        end
        next_op
      end.compact
    end
    response
  end

  def run_method_not_allowed(request, alternatives)
    methods = alternatives.map { |entry| entry[0] }
    allow = methods.uniq
    if @method_not_allowed
      payload = {
        methods: allow,
        path: request.req.path,
      }

      if @method_not_allowed.arity == 0
        response = @method_not_allowed.call
      elsif @method_not_allowed.arity >= 2
        response = @method_not_allowed.call(payload, request)
      else
        response = @method_not_allowed.call(request)
      end
    else
      response = { status: 405, body: "Method Not Allowed", headers: { "Allow" => allow.join(",") } }
    end

    response = attach_allow_header(response, allow)
    response = run_after(request, response, @after)
    attach_loop_ops(request, response)
  rescue => e
    response = { status: 405, body: "Method Not Allowed", headers: { "Allow" => allow.join(",") } }
    response
  end

  def attach_allow_header(response, methods)
    return unless response.is_a?(Hash)

    headers = response["headers"] || response[:headers] || {}
    headers = {} unless headers.is_a?(Hash)
    headers = headers.dup
    headers["Allow"] = methods.join(",")
    response["headers"] = headers
    response
  end

  def handle_error(error, request, after_callbacks = @after)
    response = if @on_error.nil?
      {
        "status" => 500,
        "body" => { "error" => "#{error.class}: #{error.message}", "backtrace" => (error.backtrace || []).first(20) },
        "headers" => { "Content-Type" => "application/json" },
      }
    elsif @on_error.arity == 0
      @on_error.call
    elsif @on_error.arity == 1
      @on_error.call(error)
    else
      @on_error.call(error, request)
    end

    unless response.is_a?(Hash)
      response = {
        "status" => 500,
        "body" => "Internal Server Error",
        "headers" => { "Content-Type" => "text/plain" },
      }
    end

    response = response.dup
    response["headers"] ||= {}
    response["headers"]["X-Homura-Error"] = error.class.to_s
    if request.is_a?(Context)
      response = run_after(request, response, after_callbacks)
      attach_loop_ops(request, response)
    end
    with_protocol_version(response)
  rescue => fallback
    response = {
      "status" => 500,
      "body" => fallback.message,
      "headers" => {
        "Content-Type" => "text/plain",
        "X-Homura-Error" => error.class.to_s,
      },
    }

    if request.is_a?(Context)
      response = run_after(request, response, after_callbacks)
      attach_loop_ops(request, response)
    end

    with_protocol_version(response)
  end

  def handle_continue_request(request)
    response = {
      "status" => 200,
      "body" => "",
      "headers" => {},
      "control" => { "continue" => true, "ops" => [] },
    }
    attach_loop_ops(request, response) if request.is_a?(Context)
    with_protocol_version(response)
  end

  def run_after(request, response, callbacks)
    current = response
    callbacks.each do |after_hook|
      result = if after_hook.arity < 0 || after_hook.arity >= 2
        after_hook.call(request, current)
      else
        after_hook.call(request)
      end
      current = result unless result.nil?
    end
    current
  end

  def run_middleware(request, middleware, final_handler)
    chain = middleware.dup
    run_next = nil
    run_next = lambda {
      if chain.empty?
        final_handler.call
      else
        mw = chain.shift
        if mw.arity >= 2 || mw.arity < 0
          mw.call(request, run_next)
        else
          mw.call(request)
        end
      end
    }
    run_next.call
  end

  def call_handler(handler, request)
    current = handler
    if current.is_a?(Hash)
      nested = current[:handler] || current["handler"]
      current = nested unless nested.nil?
    end

    unless current.respond_to?(:call)
      return {
        "status" => 500,
        "headers" => { "Content-Type" => "text/plain" },
        "body" => "Route handler is not callable",
      }
    end

    return current.call if current.arity == 0
    current.call(request)
  end

  def parse_status(response)
    status = response["status"] if response.is_a?(Hash)
    status = response[:status] if status.nil? && response.is_a?(Hash)
    return 500 unless status
    status = status.to_i
    return status if status.between?(100, 599)
    500
  end
end

class RequestContext
  def initialize(raw_env, params = {})
    @env = raw_env.is_a?(Hash) ? raw_env : {}
    @params = params || {}
  end

  def method
    fetch_env_value(@env, :method, "")
  end

  def path
    fetch_env_value(@env, :path, "/")
  end

  def query(name = nil)
    query_value = fetch_env_value(@env, :query, {})
    return query_value if name.nil?
    query_value.is_a?(Hash) ? query_value[name.to_s] : nil
  end

  def header(name = nil, default = nil)
    headers = fetch_env_value(@env, :headers, {})
    return headers if name.nil?
    return default unless headers.is_a?(Hash)

    key = name.to_s.downcase
    direct = headers[name]
    direct = direct.to_s unless direct.nil?
    direct = headers[name.to_s] unless headers.key?(name) || headers.key?(name.to_s)
    return direct unless direct.nil?

    exact = headers[name.to_sym]
    return exact unless exact.nil?

    headers.each do |candidate_key, candidate_value|
      if candidate_key.to_s.downcase == key
        return candidate_value
      end
    end

    default
  end

  def json
    body = text
    return {} if body.nil? || body.empty?
    parse_json(body)
  end

  def text
    fetch_env_value(@env, :body, "")
  end

  def param(name = nil, default = nil)
    return @params if name.nil?
    @params[name.to_sym] || @params[name.to_s] || default
  end

  def headers
    fetch_env_value(@env, :headers, {})
  end

  private

  def fetch_env_value(env, key, default = nil)
    return default if env.nil? || !env.is_a?(Hash)
    return env[key] if env.key?(key)
    return env[key.to_s] if env.key?(key.to_s)
    default
  end
end

class Context
  attr_reader :params, :env, :req, :res, :var, :d1_ops

  def initialize(env, params)
    @env = env
    @params = params || {}
    @req = RequestContext.new(env, @params)
    @var = {}
    @res = {
      status: nil,
      headers: {},
      type: nil,
      template: nil,
      props: nil,
    }
    @kv_ops = []
    @d1_ops = []
    control = fetch_env_value(@env, :control, {})
    control_ops = control.is_a?(Hash) ? (control[:ops] || control["ops"]) : nil
    @d1_results = control_ops.is_a?(Array) ? control_ops : []
    @d1_cursor = 0
  end

  def body
    @req.text || ""
  end

  def fetch_env_value(env, key, default = nil)
    return default if env.nil? || !env.is_a?(Hash)
    return env[key] if env.key?(key)
    return env[key.to_s] if env.key?(key.to_s)
    return default
  end

  def db
    @db ||= D1Client.new(self)
  end

  def json_body
    @req.json
  end

  # Response helpers
  def status(code)
    @res[:status] = code.to_i
    self
  end

  def header(name, value = nil)
    if value.nil?
      @res[:headers][name.to_s]
    else
      @res[:headers][name.to_s] = value.to_s
      self
    end
  end

  def response_status(explicit = nil)
    status = explicit || @res[:status]
    return 200 unless status
    status = status.to_i
    return status if status.between?(100, 599)
    200
  end

  def response_headers(base_headers = {})
    headers = {}
    @res[:headers].each do |key, value|
      headers[key.to_s] = value.to_s if !key.nil?
    end
    base_headers.each do |key, value|
      headers[key.to_s] = value.to_s if !key.nil?
    end
    headers
  end

  def response_with_status(status:, headers:, body:, type: nil, template: nil, props: nil)
    response = {
      status: response_status(status),
      headers: headers,
      body: body,
    }
    response[:type] = type unless type.nil?
    response[:template] = template unless template.nil?
    response[:props] = props unless props.nil?
    response
  end

  # KV operations
  def kv_get(key)
    kv_data = @env[:kv_data] || {}
    kv_data[key.to_s]
  end

  def kv_put(key, value)
    @kv_ops << { op: "put", key: key.to_s, value: value.to_s }
  end

  def kv_delete(key)
    @kv_ops << { op: "delete", key: key.to_s }
  end

  def kv_ops
    @kv_ops
  end

  def request_d1(op, sql = nil, binds = [], statements = nil)
    result = next_d1_result(op)
    return result unless result.equal?(D1_PENDING_RESULT)

    op_entry = build_d1_entry(op, sql, binds, statements)
    @d1_ops << op_entry
    raise ContinueRequest.new(self)
  end

  def d1_ops
    @d1_ops
  end

  def run_d1_batch(statements)
    request_d1("batch", nil, [], statements)
  end

  def run_d1_transaction(statements)
    request_d1("transaction", nil, [], statements)
  end

  # Response helpers
  def json(data, status: nil)
    response_with_status(
      status: status,
      headers: response_headers({ "Content-Type" => "application/json" }),
      body: data,
    )
  end

  def text(body, status: nil)
    response_with_status(
      status: status,
      headers: response_headers({ "Content-Type" => "text/plain" }),
      body: body,
    )
  end

  def html(body, status: nil)
    response_with_status(
      status: status,
      headers: response_headers({ "Content-Type" => "text/html" }),
      body: body,
    )
  end

  def jsx(template, props = {}, status: nil)
    normalized_props = {}
    if props.is_a?(Hash)
      props.each do |key, value|
        normalized_props[key.to_s] = value
      end
    end

    response_with_status(
      status: status,
      headers: response_headers({ "Content-Type" => "text/html" }),
      type: "jsx",
      template: template,
      props: normalized_props,
      body: nil,
    )
  end

  def css(body, status: nil, max_age: 0, etag: nil)
    headers = response_headers({ "Content-Type" => "text/css" })
    headers["Cache-Control"] = "public, max-age=#{max_age}" if max_age && max_age > 0
    headers["ETag"] = etag if etag
    response_with_status(
      status: status,
      headers: headers,
      body: body,
    )
  end

  def redirect(path, status: nil)
    response_with_status(
      status: status || @res[:status] || 302,
      headers: response_headers({ "Location" => path, "Content-Type" => "text/plain" }),
      body: "",
    )
  end

  def route_path
    @env[:path] || "/"
  end

  def route_method
    @env[:method] || ""
  end

  private

  D1_PENDING_RESULT = :__homura_d1_pending__

  def next_d1_result(expected_op)
    results = fetch_env_value(@env, :control, {})
    ops = results.is_a?(Hash) ? (results[:ops] || results["ops"]) : nil
    list = ops.is_a?(Array) ? ops : []

    while @d1_cursor < list.length
      next_result = list[@d1_cursor]
      @d1_cursor += 1
      next unless next_result.is_a?(Hash)

      op = next_result["op"] || next_result[:op]
      kind = next_result["kind"] || next_result[:kind]
      next unless kind == "d1" || kind.nil? && ["all", "first", "get", "run", "exec", "batch", "transaction"].include?(op.to_s)

      ok = next_result["ok"] || next_result[:ok]
      if ok == false || ok == "false"
        raise RuntimeError, normalize_d1_error(next_result)
      end

      payload = next_result["result"] || next_result[:result]
      return normalize_d1_payload(expected_op, payload)
    end

    D1_PENDING_RESULT
  end

  def run_d1_op(op, sql, binds)
    request_d1(op, sql, binds, nil)
  end

  def build_d1_entry(op, sql, binds, statements)
    if statements
      normalized_statements = statements.map do |statement|
        next unless statement.is_a?(Hash)
        {
          op: statement[:op] || statement["op"],
          sql: statement[:sql] || statement["sql"],
          binds: normalize_d1_binds(statement[:binds] || statement["binds"]),
        }
      end.compact
      { op: op, statements: normalized_statements }
    else
      { op: op, sql: sql, binds: normalize_d1_binds(binds) }
    end
  end

  def normalize_d1_payload(expected_op, payload)
    return payload unless expected_op.is_a?(String)

    data = payload
    if expected_op == "get" || expected_op == "first"
      if data.is_a?(Array)
        return data[0]
      end
      if data.is_a?(Hash)
        return data["result"] || data["results"] || data[:result] || data[:results] || data
      end
      return data
    end

    if expected_op == "all" && data.is_a?(Hash)
      rows = data["results"] || data[:results]
      return rows.is_a?(Array) ? rows : []
    end

    return data if expected_op == "exec" || expected_op == "run" || expected_op == "all" || expected_op == "batch" || expected_op == "transaction"
    data
  end

  def normalize_d1_binds(raw_bind)
    return [] if raw_bind.nil?
    return raw_bind if raw_bind.is_a?(Array)
    raise ArgumentError, "D1 bind parameters must be an array"
  end

  def normalize_d1_error(result)
    return "Unknown database error" unless result.is_a?(Hash)
    message = result["error"] || result[:error]
    if message.nil? && result["meta"].is_a?(Hash)
      message = result["meta"]["error"]
    end
    if message.nil? && result[:meta].is_a?(Hash)
      message = result[:meta][:error]
    end
    return message.is_a?(String) && !message.empty? ? message : "Unknown database error"
  end
end

class D1Client
  def initialize(context)
    @context = context
  end

  def get(sql, binds = nil)
    @context.request_d1("get", sql, binds || [])
  end

  def all(sql, binds = nil)
    @context.request_d1("all", sql, binds || [])
  end

  def first(sql, binds = nil)
    @context.request_d1("first", sql, binds || [])
  end

  def run(sql, binds = nil)
    result = @context.request_d1("run", sql, binds || [])
    return result unless result.is_a?(Hash)
    if result.key?("result") || result.key?(:result) || result.key?("meta") || result.key?(:meta)
      meta = result["meta"] || result[:meta]
      {
        "result" => result["result"] || result[:result],
        "affected_rows" => extract_meta_number(meta, "changes") || extract_meta_number(meta, "affected_rows"),
        "last_row_id" => extract_meta_number(meta, "last_row_id"),
      }
    end
    result
  end

  def exec(sql)
    @context.request_d1("exec", sql)
  end

  def batch(statements)
    parsed = normalize_statements(statements)
    @context.run_d1_batch(parsed)
  end

  def transaction(statements)
    parsed = normalize_statements(statements)
    @context.run_d1_transaction(parsed)
  end

  private

  def normalize_statements(statements)
    list = statements.is_a?(Array) ? statements : []
    list.map do |entry|
      next unless entry.is_a?(Hash)
      {
        op: entry[:op] || entry["op"],
        sql: entry[:sql] || entry["sql"],
        binds: normalize_binds(entry[:binds] || entry["binds"]),
      }
    end.compact
  end

  def normalize_binds(raw)
    return [] if raw.nil?
    return raw if raw.is_a?(Array)
    raise ArgumentError, "D1 bind parameters must be an array"
  end

  def extract_meta_number(meta, key)
    return nil unless meta.is_a?(Hash)
    value = meta[key] || meta[key.to_sym]
    return value.to_i if value.is_a?(Numeric)
    return value.to_i if value.is_a?(String) && !value.empty?
    nil
  end
end

module View
  def self.h(text)
    s = text.to_s
    out = ""
    s.each_byte do |b|
      case b
      when 38 then out << "&amp;"
      when 60 then out << "&lt;"
      when 62 then out << "&gt;"
      when 34 then out << "&quot;"
      when 39 then out << "&#39;"
      else out << b.chr
      end
    end
    out
  end
end

class Object
  def to_json
    case self
    when NilClass then "null"
    when TrueClass then "true"
    when FalseClass then "false"
    when Integer, Float then self.to_s
    when String then "\"" + self.gsub("\\", "\\\\").gsub("\"", "\\\"") + "\""
    when Symbol then "\"" + self.to_s + "\""
    when Array then "[" + self.map { |e| e.to_json }.join(",") + "]"
    when Hash then "{" + self.map { |k, v| "\"#{k}\":" + v.to_json }.join(",") + "}"
    else "\"" + self.to_s + "\""
    end
  end
end

def parse_json(str)
  return {} if str.nil? || str.empty?
  str = str.strip

  if Object.const_defined?(:JSON)
    json_parser = Object.const_get(:JSON)
    if json_parser.respond_to?(:parse)
      begin
        return json_parser.parse(str)
      rescue => e
        raise RuntimeError, "Invalid JSON: #{e.message}"
      end
    end
  end

  return nil if str == "null"
  return true if str == "true"
  return false if str == "false"

  if str.match?(/\A-?\d+(\.\d+)?([eE][+-]?\d+)?\z/)
    return str.include?(".") ? str.to_f : str.to_i
  end

  if str.start_with?("\"") && str.end_with?("\"")
    return str[1..-2]
  end

  if str.start_with?("{") && str.end_with?("}")
    result = {}
    content = str[1..-2].strip
    return result if content.empty?

    pairs = []
    depth = 0
    current = ""
    content.each_char do |c|
      if c == "{" || c == "["
        depth += 1
        current << c
      elsif c == "}" || c == "]"
        depth -= 1
        current << c
      elsif c == "," && depth == 0
        pairs << current.strip
        current = ""
      else
        current << c
      end
    end
    pairs << current.strip unless current.empty?

    pairs.each do |pair|
      colon_idx = nil
      in_string = false
      pair.each_char.with_index do |c, i|
        if c == "\"" && (i == 0 || pair[i-1] != "\\")
          in_string = !in_string
        elsif c == ":" && !in_string
          colon_idx = i
          break
        end
      end

      raise RuntimeError, "Invalid JSON: malformed object" unless colon_idx
      key_part = pair[0...colon_idx].strip
      val_part = pair[(colon_idx+1)..-1].strip
      if key_part.start_with?("\"") && key_part.end_with?("\"")
        key = key_part[1..-2]
        result[key] = parse_json(val_part)
      else
        raise RuntimeError, "Invalid JSON: invalid object key"
      end
    end
    return result
  end

  if str.start_with?("[") && str.end_with?("]")
    content = str[1..-2].strip
    return [] if content.empty?

    values = []
    depth = 0
    in_string = false
    current = ""
    content.each_char.with_index do |c, i|
      if c == "\"" && (i == 0 || content[i - 1] != "\\")
        in_string = !in_string
      end
      if !in_string && (c == "[" || c == "{")
        depth += 1
      elsif !in_string && (c == "]" || c == "}")
        depth -= 1
      elsif c == "," && depth == 0
        values << parse_json(current.strip)
        current = ""
        next
      end
      current << c
    end
    values << parse_json(current.strip) unless current.empty?
    return values
  end

  raise RuntimeError, "Invalid JSON"
end

$app = Homura.new
