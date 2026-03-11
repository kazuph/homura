# Todo App - Route Definitions
# Showcases: CRUD, scoped queries, enum, associations, query extensions

# ===== HTML Pages =====

# GET / - Todo list with filters
$app.get "/" do |c|
  status_filter = c.req.query("status") || ""
  category_filter = c.req.query("category") || ""

  query = Todo.order("id DESC")
  if status_filter == "pending"
    query = Todo.pending.order("id DESC")
  elsif status_filter == "in_progress"
    query = Todo.in_progress.order("id DESC")
  elsif status_filter == "done"
    query = Todo.done.order("id DESC")
  end

  if category_filter != "" && category_filter.to_i > 0
    query = query.where(category_id: category_filter.to_i)
  end

  todos = query.all(c.db)
  categories = Category.order("name ASC").all(c.db)

  total = Todo.where({}).count(c.db)
  pending_count = Todo.pending.count(c.db)
  in_progress_count = Todo.in_progress.count(c.db)
  done_count = Todo.done.count(c.db)

  c.jsx("index", {
    todos: todos.map { |t| t.to_h },
    categories: categories.map { |cat| cat.to_h },
    stats: {
      total: total,
      pending: pending_count,
      in_progress: in_progress_count,
      done: done_count
    },
    current_status: status_filter,
    current_category: category_filter
  })
end

# GET /todos/new - New todo form
$app.get "/todos/new" do |c|
  categories = Category.order("name ASC").all(c.db)
  c.jsx("new", { categories: categories.map { |cat| cat.to_h }, errors: [] })
end

# POST /todos - Create todo
$app.post "/todos" do |c|
  body = c.req.parse_body
  todo = Todo.new({
    title: body["title"] || "",
    description: body["description"] || "",
    status: (body["status"] || "0").to_i,
    priority: (body["priority"] || "2").to_i,
    due_date: body["due_date"] || "",
    category_id: body["category_id"].to_s == "" ? nil : body["category_id"].to_i
  })

  if todo.valid?
    todo.save(c.db)
    c.redirect("/")
  else
    categories = Category.order("name ASC").all(c.db)
    c.jsx("new", {
      categories: categories.map { |cat| cat.to_h },
      errors: todo.errors,
      values: body
    })
  end
end

# GET /todos/:id/edit - Edit todo form
$app.get "/todos/:id/edit" do |c|
  id = c.req.param("id").to_i
  todo = Todo.find(c.db, id)
  unless todo
    c.redirect("/")
  else
    categories = Category.order("name ASC").all(c.db)
    c.jsx("edit", {
      todo: todo.to_h,
      categories: categories.map { |cat| cat.to_h },
      errors: []
    })
  end
end

# POST /todos/:id - Update todo
$app.post "/todos/:id" do |c|
  id = c.req.param("id").to_i
  todo = Todo.find(c.db, id)
  unless todo
    c.redirect("/")
  else
    body = c.req.parse_body
    todo.title = body["title"] || todo.title
    todo.description = body["description"] || ""
    todo.status = (body["status"] || "0").to_i
    todo.priority = (body["priority"] || "2").to_i
    todo.due_date = body["due_date"] || ""
    cat_id = body["category_id"].to_s
    todo.category_id = cat_id == "" ? nil : cat_id.to_i

    if todo.valid?
      todo.save(c.db)
      c.redirect("/")
    else
      categories = Category.order("name ASC").all(c.db)
      c.jsx("edit", {
        todo: todo.to_h,
        categories: categories.map { |cat| cat.to_h },
        errors: todo.errors
      })
    end
  end
end

# POST /todos/:id/toggle - Toggle status (pending -> in_progress -> done -> pending)
$app.post "/todos/:id/toggle" do |c|
  id = c.req.param("id").to_i
  todo = Todo.find(c.db, id)
  unless todo
    c.redirect("/")
  else
    current = todo.status_value || 0
    next_status = (current + 1) % 3
    if next_status == 0
      todo.pending!
    elsif next_status == 1
      todo.in_progress!
    else
      todo.done!
    end
    todo.save(c.db)
    c.redirect("/")
  end
end

# POST /todos/:id/delete - Delete todo
$app.post "/todos/:id/delete" do |c|
  id = c.req.param("id").to_i
  todo = Todo.find(c.db, id)
  todo.destroy(c.db) if todo
  c.redirect("/")
end

# ===== Categories =====

# GET /categories - Category management page
$app.get "/categories" do |c|
  categories = Category.order("name ASC").all(c.db)
  cats_with_count = categories.map do |cat|
    h = cat.to_h
    h[:todo_count] = Todo.by_category(cat.id).count(c.db)
    h
  end
  c.jsx("categories", { categories: cats_with_count, errors: [] })
end

# POST /categories - Create category
$app.post "/categories" do |c|
  body = c.req.parse_body
  cat = Category.new({
    name: body["name"] || "",
    color: body["color"] || "#6366f1"
  })

  if cat.valid?
    cat.save(c.db)
    c.redirect("/categories")
  else
    categories = Category.order("name ASC").all(c.db)
    cats_with_count = categories.map do |ca|
      h = ca.to_h
      h[:todo_count] = Todo.by_category(ca.id).count(c.db)
      h
    end
    c.jsx("categories", { categories: cats_with_count, errors: cat.errors })
  end
end

# POST /categories/:id/delete - Delete category
$app.post "/categories/:id/delete" do |c|
  id = c.req.param("id").to_i
  cat = Category.find(c.db, id)
  cat.destroy(c.db) if cat
  c.redirect("/categories")
end

# ===== JSON API (ORM feature demos) =====

# GET /api/stats - Statistics using count + scopes
$app.get "/api/stats" do |c|
  c.json({
    total: Todo.where({}).count(c.db),
    pending: Todo.pending.count(c.db),
    in_progress: Todo.in_progress.count(c.db),
    done: Todo.done.count(c.db),
    high_priority: Todo.high_priority.count(c.db),
    categories: Category.where({}).count(c.db),
    statuses: Todo.statuses
  })
end

# GET /api/todos - JSON list
$app.get "/api/todos" do |c|
  todos = Todo.order("id DESC").all(c.db)
  c.json({ data: todos.map { |t| t.to_h } })
end

# GET /api/todos/pluck-titles - pluck demo
$app.get "/api/todos/pluck-titles" do |c|
  titles = Todo.order("id ASC").pluck(:title, c.db)
  c.json({ titles: titles })
end

# GET /api/todos/ids - ids demo
$app.get "/api/todos/ids" do |c|
  ids = Todo.order("id ASC").ids(c.db)
  c.json({ ids: ids })
end

# GET /api/todos/query/exists - exists? demo
$app.get "/api/todos/query/exists" do |c|
  title = c.req.query("title") || ""
  exists = Todo.where(title: title).exists?(c.db)
  c.json({ title: title, exists: exists })
end

# POST /api/todos/find-or-create - find_or_create_by demo
$app.post "/api/todos/find-or-create" do |c|
  body = c.json_body || {}
  todo = Todo.find_or_create_by(c.db, body)
  if todo
    c.json(todo.to_h)
  else
    c.json({ error: "Failed" }, status: 500)
  end
end

# GET /api/todos/not-done - where.not demo
$app.get "/api/todos/not-done" do |c|
  todos = Todo.where.not(status: 2).order("id DESC").all(c.db)
  c.json({ data: todos.map { |t| t.to_h }, count: todos.length })
end

# PUT /api/todos/:id/track-changes - dirty tracking demo
$app.put "/api/todos/:id/track-changes" do |c|
  id = c.req.param("id").to_i
  todo = Todo.find(c.db, id)
  unless todo
    c.json({ error: "Not found" }, status: 404)
  else
    before_changed = todo.changed?
    body = c.json_body || {}
    new_title = body["title"] || body[:title]
    todo.title = new_title if new_title

    c.json({
      before_changed: before_changed,
      after_changed: todo.changed?,
      title_changed: todo.title_changed?,
      title_was: todo.title_was,
      changes: todo.changes.to_h
    })
  end
end

# POST /api/test/reset-db - Test helper
$app.post "/api/test/reset-db" do |c|
  c.db.run("DELETE FROM todos", [])
  c.db.run("DELETE FROM categories", [])
  c.json({ ok: true })
end
