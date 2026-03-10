# Time Tracker - demonstrates mruby-time + mruby-pack + mruby-bigint + D1

class TimeUtils
  SECONDS_PER_MINUTE = 60
  SECONDS_PER_HOUR = 3600
  SECONDS_PER_DAY = 86400

  def self.now_unix
    Time.now.to_i
  end

  def self.time_window(seconds, window_size)
    seconds / window_size
  end

  def self.format_duration(seconds)
    if seconds < SECONDS_PER_MINUTE
      "#{seconds}s"
    elsif seconds < SECONDS_PER_HOUR
      "#{seconds / SECONDS_PER_MINUTE}m #{seconds % SECONDS_PER_MINUTE}s"
    elsif seconds < SECONDS_PER_DAY
      hours = seconds / SECONDS_PER_HOUR
      mins = (seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
      "#{hours}h #{mins}m"
    else
      days = seconds / SECONDS_PER_DAY
      hours = (seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR
      "#{days}d #{hours}h"
    end
  end

  # Generate a time-based token (simplified, not cryptographic)
  def self.time_token(secret_seed, window = 30)
    now = now_unix
    counter = time_window(now, window)
    # Simple hash: combine seed with counter
    combined = "#{secret_seed}:#{counter}"
    hash = 0
    combined.each_byte { |b| hash = ((hash << 5) - hash + b) & 0xFFFFFFFF }
    # Format as 6-digit code
    code = hash % 1000000
    "%06d" % code
  end
end

# POST /events - Log a timed event
$app.post "/events" do |c|
  body = c.json_body
  name = body && (body["name"] || body[:name])
  unless name
    c.json({ error: "name required" }, status: 400)
  else
    now = TimeUtils.now_unix
    c.db.run(
      "INSERT INTO events (name, timestamp, created_at) VALUES (?, ?, datetime('now'))",
      [name, now]
    )
    meta = c.db.get("SELECT last_insert_rowid() AS id")
    c.json({ id: meta && (meta["id"] || meta[:id]), name: name, timestamp: now }, status: 201)
  end
end

# GET /events - List recent events
$app.get "/events" do |c|
  window = (c.req.query("window") || "3600").to_i  # Default 1 hour
  cutoff = TimeUtils.now_unix - window
  rows = c.db.all(
    "SELECT id, name, timestamp, created_at FROM events WHERE timestamp >= ? ORDER BY timestamp DESC",
    [cutoff]
  )
  events = (rows || []).map do |row|
    elapsed = TimeUtils.now_unix - (row["timestamp"] || row[:timestamp] || 0).to_i
    row["elapsed"] = TimeUtils.format_duration(elapsed)
    row
  end
  c.json({ events: events, window: TimeUtils.format_duration(window), count: events.length })
end

# GET /events/stats - Aggregated stats
$app.get "/events/stats" do |c|
  rows = c.db.all(
    "SELECT name, COUNT(*) as count, MIN(timestamp) as first_seen, MAX(timestamp) as last_seen FROM events GROUP BY name ORDER BY count DESC"
  )
  stats = (rows || []).map do |row|
    first = (row["first_seen"] || row[:first_seen] || 0).to_i
    last = (row["last_seen"] || row[:last_seen] || 0).to_i
    row["duration"] = TimeUtils.format_duration(last - first)
    row
  end
  c.json({ stats: stats })
end

# GET /token - Generate time-based token
$app.get "/token" do |c|
  seed = c.req.query("seed") || "homura-default"
  window = (c.req.query("window") || "30").to_i
  token = TimeUtils.time_token(seed, window)
  remaining = window - (TimeUtils.now_unix % window)
  c.json({
    token: token,
    seed: seed,
    window_seconds: window,
    remaining_seconds: remaining,
    generated_at: TimeUtils.now_unix
  })
end

# GET / - HTML UI
$app.get "/" do |c|
  c.jsx("home", {})
end

# GET /api - API info
$app.get "/api" do |c|
  c.json({
    name: "Time Tracker",
    description: "Time-based features using mruby-time + mruby-pack",
    endpoints: [
      { method: "POST", path: "/events", body: { name: "deploy" } },
      { method: "GET", path: "/events?window=3600" },
      { method: "GET", path: "/events/stats" },
      { method: "GET", path: "/token?seed=mysecret&window=30" }
    ]
  })
end

$app.get "/api/test-gems" do |c|
  now = Time.now
  packed = [now.to_i].pack("N")
  unpacked = packed.unpack("N")
  big = 2 ** 64
  c.json({
    time_now: now.to_i,
    time_class: now.class.to_s,
    pack_unpack: unpacked,
    bigint: big.to_s,
    rational: (1.to_r / 3).to_f
  })
end
