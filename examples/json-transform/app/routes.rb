# JSON Transform Pipeline - demonstrates Enumerable, Lazy, Set

$app.post "/transform/filter" do |c|
  body = c.json_body
  data = body && (body["data"] || body[:data])
  field = body && (body["field"] || body[:field])
  value = body && (body["value"] || body[:value])

  unless data.is_a?(Array)
    c.json({ error: "data must be an array" }, status: 400)
  else
    result = data.select { |item| item.is_a?(Hash) && item[field] == value }
    c.json({ result: result, count: result.length })
  end
end

$app.post "/transform/map" do |c|
  body = c.json_body
  data = body && (body["data"] || body[:data])
  fields = body && (body["fields"] || body[:fields])

  unless data.is_a?(Array) && fields.is_a?(Array)
    c.json({ error: "data and fields required" }, status: 400)
  else
    result = data.map do |item|
      next nil unless item.is_a?(Hash)
      picked = {}
      fields.each { |field| picked[field] = item[field] if item.key?(field) }
      picked
    end.compact
    c.json({ result: result })
  end
end

$app.post "/transform/group" do |c|
  body = c.json_body
  data = body && (body["data"] || body[:data])
  field = body && (body["field"] || body[:field])

  unless data.is_a?(Array) && field
    c.json({ error: "data and field required" }, status: 400)
  else
    groups = {}
    data.each do |item|
      next unless item.is_a?(Hash)
      key = (item[field] || "null").to_s
      groups[key] ||= []
      groups[key] << item
    end
    c.json({ result: groups })
  end
end

$app.post "/transform/unique" do |c|
  body = c.json_body
  data = body && (body["data"] || body[:data])
  field = body && (body["field"] || body[:field])

  unless data.is_a?(Array) && field
    c.json({ error: "data and field required" }, status: 400)
  else
    seen = Set.new
    result = []
    data.each do |item|
      next unless item.is_a?(Hash)
      value = item[field]
      unless seen.include?(value)
        seen.add(value)
        result << item
      end
    end
    c.json({ result: result, unique_count: seen.length })
  end
end

$app.post "/transform/pipeline" do |c|
  body = c.json_body
  data = body && (body["data"] || body[:data])
  ops = body && (body["operations"] || body[:operations])

  unless data.is_a?(Array) && ops.is_a?(Array)
    c.json({ error: "data and operations required" }, status: 400)
  else
    result = data
    ops.each do |op|
      next unless op.is_a?(Hash)
      type = op["type"] || op[:type]

      case type
      when "filter"
        field = op["field"] || op[:field]
        value = op["value"] || op[:value]
        result = result.select { |item| item.is_a?(Hash) && item[field] == value }
      when "sort"
        field = op["field"] || op[:field]
        direction = (op["direction"] || op[:direction] || "asc").to_s
        result = result.sort_by { |item| item.is_a?(Hash) ? (item[field] || "") : "" }
        result = result.reverse if direction == "desc"
      when "limit"
        count = (op["count"] || op[:count] || 10).to_i
        result = result[0, count] || []
      when "map"
        fields = op["fields"] || op[:fields]
        if fields.is_a?(Array)
          result = result.map do |item|
            next nil unless item.is_a?(Hash)
            picked = {}
            fields.each { |field| picked[field] = item[field] if item.key?(field) }
            picked
          end.compact
        end
      end
    end
    c.json({ result: result, count: result.length })
  end
end

$app.get "/" do |c|
  c.jsx("home", {})
end

$app.get "/api" do |c|
  c.json({
    name: "JSON Transform Pipeline",
    description: "Ruby Enumerable power on Cloudflare Workers",
    endpoints: [
      { method: "POST", path: "/transform/filter", description: "Filter array by field value" },
      { method: "POST", path: "/transform/map", description: "Pick specific fields" },
      { method: "POST", path: "/transform/group", description: "Group by field" },
      { method: "POST", path: "/transform/unique", description: "Deduplicate by field using Set" },
      { method: "POST", path: "/transform/pipeline", description: "Chain multiple operations" }
    ],
    powered_by: "mruby #{Homura::VERSION} (Enumerable + Lazy + Set)"
  })
end

$app.get "/api/test-gems" do |c|
  numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  lazy_numbers = numbers.lazy
  filtered_numbers = lazy_numbers.select { |x| x > 3 }
  doubled_numbers = filtered_numbers.map { |x| x * 2 }
  lazy_result = doubled_numbers.first(3)

  enumerator_result = []
  [1, 2, 3].each do |x|
    enumerator_result << x * 10
  end

  c.json({
    lazy_enumerator: lazy_result,
    set: Set.new([1, 1, 2, 2, 3, 3]).to_a,
    enumerator: enumerator_result
  })
end
