# URL Shortener - demonstrates mruby-random + mruby-pack + KV

# Base62 encoding using mruby-pack
CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

def generate_code(length = 6)
  code = ""
  length.times do
    code << CHARS[rand(CHARS.length)]
  end
  code
end

def valid_redirect_url?(url)
  return false unless url.is_a?(String)
  return false if url.empty?
  url.start_with?("http://") || url.start_with?("https://")
end

# POST /shorten - Create short URL
$app.post "/shorten" do |c|
  body = c.json_body
  url = body && (body["url"] || body[:url])
  if !url || !url.is_a?(String) || url.empty?
    c.json({ error: "url is required" }, status: 400)
  elsif !valid_redirect_url?(url)
    c.json({ error: "url must start with http:// or https://" }, status: 400)
  else
    code = generate_code
    # Store: code -> url
    c.kv_put("url:#{code}", url)
    # Store: code:count -> 0
    c.kv_put("count:#{code}", "0")
    c.json({ code: code, short_url: "/s/#{code}", original_url: url }, status: 201)
  end
end

# GET /s/:code - Redirect to original URL
$app.get "/s/:code" do |c|
  code = c.req.param("code")
  url = c.kv_get("url:#{code}")
  if url && valid_redirect_url?(url)
    # Increment counter
    count = (c.kv_get("count:#{code}") || "0").to_i + 1
    c.kv_put("count:#{code}", count.to_s)
    c.redirect(url, status: 302)
  elsif url
    c.json({ error: "Stored URL has invalid scheme" }, status: 400)
  else
    c.json({ error: "Short URL not found" }, status: 404)
  end
end

# GET /api/stats/:code - Get click stats
$app.get "/api/stats/:code" do |c|
  code = c.req.param("code")
  url = c.kv_get("url:#{code}")
  if url
    count = (c.kv_get("count:#{code}") || "0").to_i
    c.json({ code: code, original_url: url, clicks: count })
  else
    c.json({ error: "Short URL not found" }, status: 404)
  end
end

# GET / - Home page with form
$app.get "/" do |c|
  c.jsx("home", {})
end

# GET /api/test-gems - Verify new gems work
$app.get "/api/test-gems" do |c|
  c.json({
    random: rand(1000),
    time: Time.now.to_i,
    pack: [72, 101, 108, 108, 111].pack("C*"),
    set: Set.new([1,2,3,2,1]).to_a.length
  })
end
