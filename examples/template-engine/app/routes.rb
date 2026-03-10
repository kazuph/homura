# Micro Template Engine - demonstrates safe variable interpolation

class MicroTemplate
  def initialize(template_str)
    @template = template_str
  end

  def escape_html(value)
    text = value.to_s
    escaped = ""
    idx = 0
    while idx < text.length
      byte = text.getbyte(idx)
      if byte == 38
        escaped << "&amp;"
      elsif byte == 60
        escaped << "&lt;"
      elsif byte == 62
        escaped << "&gt;"
      elsif byte == 34
        escaped << "&quot;"
      else
        escaped << text[idx, 1]
      end
      idx += 1
    end
    escaped
  end

  def render(locals = {})
    result = @template.dup
    output = ""
    pos = 0

    while pos < result.length
      start_tag = result.index("{{", pos)
      if start_tag
        output << result[pos...start_tag]
        end_tag = result.index("}}", start_tag)
        if end_tag
          key = result[(start_tag + 2)...end_tag].to_s.strip
          value = locals[key]
          value = locals[key.to_sym] if value.nil? && !locals.key?(key)
          output << escape_html(value)
          pos = end_tag + 2
        else
          output << result[pos..]
          break
        end
      else
        output << result[pos..]
        break
      end
    end
    output
  end
end

# Template registry
$templates = {}

$templates["page"] = MicroTemplate.new(<<'TMPL')
<html>
<head><title>{{title}}</title></head>
<body>
<h1>{{title}}</h1>
<p>{{body}}</p>
<footer>Rendered by MicroTemplate on mruby + WASI</footer>
</body>
</html>
TMPL

$templates["list"] = MicroTemplate.new(<<'TMPL')
<html>
<head><title>{{title}}</title></head>
<body>
<h1>{{title}}</h1>
<p>Items count: {{item_count}}</p>
<p>Generated at: {{generated_at}}</p>
</body>
</html>
TMPL

def template_locals(data)
  locals = {}
  if data.is_a?(Hash)
    data.each do |key, value|
      locals[key.to_s] = value
    end
  end
  items = locals["items"]
  if items.is_a?(Array)
    locals["item_count"] = items.length
  end
  locals["generated_at"] = Time.now.to_i unless locals.key?("generated_at")
  locals
end

# POST /render - Render a template with data
$app.post "/render" do |c|
  body = c.json_body
  template_name = body && (body["template"] || body[:template])
  locals = template_locals(body && (body["data"] || body[:data]) || {})

  tmpl = $templates[template_name]
  unless tmpl
    c.json({ error: "Template '#{template_name}' not found", available: $templates.keys }, status: 404)
  else
    html = tmpl.render(locals)
    c.html(html)
  end
end

# POST /render/inline - Render inline template
$app.post "/render/inline" do |c|
  body = c.json_body
  template_str = body && (body["template"] || body[:template])
  locals = template_locals(body && (body["data"] || body[:data]) || {})

  unless template_str
    c.json({ error: "template string required" }, status: 400)
  else
    tmpl = MicroTemplate.new(template_str)
    html = tmpl.render(locals)
    c.html(html)
  end
end

$app.get "/templates" do |c|
  c.json({ templates: $templates.keys })
end

$app.get "/" do |c|
  c.jsx("home", {})
end

$app.get "/api" do |c|
  c.json({
    name: "Micro Template Engine",
    description: "Safe HTML-escaped templates running in mruby on Workers",
    features: ["{{variable}} interpolation", "HTML escaping", "precomputed template locals"],
    endpoints: [
      { method: "POST", path: "/render", body: { template: "page", data: { title: "Hello", body: "World" } } },
      { method: "POST", path: "/render/inline", body: { template: "Hello {{name}}", data: { name: "World" } } },
      { method: "GET", path: "/templates" },
    ],
  })
end

$app.get "/api/test-gems" do |c|
  rendered = MicroTemplate.new("<p>{{message}}</p>").render({ "message" => '<script>alert("x")</script>' })
  c.json({
    html_escape: rendered,
    templates: $templates.keys,
    generated_at: Time.now.to_i,
  })
end
