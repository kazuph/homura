# Homura - A Hono-like Ruby DSL for Cloudflare Workers
# This file is the framework core - users don't need to modify this

class Homura
  def initialize
    @routes = {}
    @not_found = nil
    @middleware = []
  end

  # Middleware registration: use { |ctx, nxt| nxt.call }
  def use(&block)
    @middleware << block
  end

  def get(path, &block)
    @routes[["GET", path]] = block
  end

  def post(path, &block)
    @routes[["POST", path]] = block
  end

  def put(path, &block)
    @routes[["PUT", path]] = block
  end

  def patch(path, &block)
    @routes[["PATCH", path]] = block
  end

  def delete(path, &block)
    @routes[["DELETE", path]] = block
  end

  def match_route(method, path)
    path_parts = path.split("/").reject { |p| p.empty? }
    @routes.each do |(route_method, pattern), handler|
      next unless route_method == method
      pattern_parts = pattern.split("/").reject { |p| p.empty? }
      next unless pattern_parts.length == path_parts.length

      params = {}
      matched = true
      pattern_parts.each_with_index do |part, idx|
        if part.start_with?(":")
          params[part[1..-1].to_sym] = path_parts[idx]
        elsif part != path_parts[idx]
          matched = false
          break
        end
      end

      return [handler, params] if matched
    end
    nil
  end

  def call(env)
    result = match_route(env[:method], env[:path])
    if result
      handler, params = result
      ctx = Context.new(env, params)
      response = run_middleware(ctx) { handler.call(ctx) }
      response[:kv_ops] = ctx.kv_ops if ctx.kv_ops && !ctx.kv_ops.empty?
      response
    else
      if @not_found
        ctx = Context.new(env, {})
        response = run_middleware(ctx) { @not_found.call(ctx) }
        response[:kv_ops] = ctx.kv_ops if ctx.kv_ops && !ctx.kv_ops.empty?
        response
      else
        { status: 404, body: "Not Found", headers: {} }
      end
    end
  end

  def not_found(&block)
    @not_found = block
  end

  private

  def run_middleware(ctx, &final_handler)
    chain = @middleware.dup
    run_next = nil
    run_next = lambda {
      if chain.empty?
        final_handler.call
      else
        mw = chain.shift
        mw.call(ctx, run_next)
      end
    }
    run_next.call
  end
end

class Context
  attr_reader :params, :env

  def initialize(env, params)
    @env = env
    @params = params
    @kv_ops = []
  end

  def body
    @env[:body] || ""
  end

  def json_body
    body_str = body
    return {} if body_str.nil? || body_str.empty?
    parse_json(body_str)
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

  # Response helpers
  def json(data, status: 200)
    { status: status, body: data, headers: { "Content-Type" => "application/json" } }
  end

  def text(body, status: 200)
    { status: status, body: body, headers: { "Content-Type" => "text/plain" } }
  end

  def html(body, status: 200)
    { status: status, body: body, headers: { "Content-Type" => "text/html" } }
  end

  def jsx(template, props = {}, status: 200)
    { status: status, type: "jsx", template: template, props: props, headers: { "Content-Type" => "text/html" } }
  end

  def css(body, status: 200, max_age: 0, etag: nil)
    headers = { "Content-Type" => "text/css" }
    headers["Cache-Control"] = "public, max-age=#{max_age}" if max_age && max_age > 0
    headers["ETag"] = etag if etag
    { status: status, body: body, headers: headers }
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
  return nil if str == "null"
  return true if str == "true"
  return false if str == "false"

  if str.length > 0 && (str[0] == "-" || (str[0] >= "0" && str[0] <= "9"))
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

      if colon_idx
        key_part = pair[0...colon_idx].strip
        val_part = pair[(colon_idx+1)..-1].strip
        if key_part.start_with?("\"") && key_part.end_with?("\"")
          key = key_part[1..-2].to_sym
          result[key] = parse_json(val_part)
        end
      end
    end
    return result
  end

  str
end

$app = Homura.new
