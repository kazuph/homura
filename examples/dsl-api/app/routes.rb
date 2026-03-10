# DSL-Driven API Builder - demonstrates metaprog + Homura::Model

# Helper: auto-generate CRUD routes for a model
def auto_crud(app, model_class, prefix = nil)
  prefix ||= "/api/#{model_class.table_name}"

  # GET /api/<table> - List all
  app.get prefix do |c|
    page = (c.req.query("page") || "1").to_i
    per = (c.req.query("per") || "20").to_i
    offset = (page - 1) * per

    query = model_class.order("id DESC").limit(per)
    query = query.offset(offset) if offset > 0
    records = query.all(c.db)
    total = model_class.where({}).count(c.db)

    c.json({
      data: records.map { |record| record.to_h },
      meta: { page: page, per: per, total: total }
    })
  end

  # GET /api/<table>/:id - Show one
  app.get "#{prefix}/:id" do |c|
    id = c.req.param("id").to_i
    record = model_class.find(c.db, id)
    if record
      c.json(record.to_h)
    else
      c.json({ error: "Not found" }, status: 404)
    end
  end

  # POST /api/<table> - Create
  app.post prefix do |c|
    body = c.json_body
    unless body.is_a?(Hash)
      c.json({ error: "JSON body required" }, status: 400)
    else
      record = model_class.new(body)
      if record.valid?
        record.save(c.db)
        c.json(record.to_h, status: 201)
      else
        c.json({ errors: record.errors }, status: 422)
      end
    end
  end

  # PUT /api/<table>/:id - Update
  app.put "#{prefix}/:id" do |c|
    id = c.req.param("id").to_i
    record = model_class.find(c.db, id)
    unless record
      c.json({ error: "Not found" }, status: 404)
    else
      body = c.json_body || {}
      record.update_attrs(c.db, body)
      c.json(record.to_h)
    end
  end

  # DELETE /api/<table>/:id - Delete
  app.delete "#{prefix}/:id" do |c|
    id = c.req.param("id").to_i
    record = model_class.find(c.db, id)
    unless record
      c.json({ error: "Not found" }, status: 404)
    else
      record.destroy(c.db)
      c.json({ ok: true, id: id })
    end
  end
end

# ===== Define Models =====

class Article < Homura::Model
  table :articles
  column :id, :integer
  column :title, :string
  column :body, :string
  column :author, :string
  column :published, :boolean
  column :created_at, :string
  column :updated_at, :string

  validates :title, presence: true
  validates :body, presence: true
end

class Tag < Homura::Model
  table :tags
  column :id, :integer
  column :name, :string
  column :created_at, :string

  validates :name, presence: true
end

# GET /api/articles/published - Only published articles
$app.get "/api/articles/published" do |c|
  articles = Article.where(published: true).order("id DESC").all(c.db)
  c.json({ data: articles.map { |article| article.to_h }, count: articles.length })
end

# ===== Auto-generate CRUD =====

auto_crud($app, Article)
auto_crud($app, Tag)

# GET / - HTML UI
$app.get "/" do |c|
  c.jsx("home", {})
end

# GET /api - API docs
$app.get "/api" do |c|
  c.json({
    name: "DSL-Driven API Builder",
    description: "ActiveRecord-style models with auto-generated CRUD on Cloudflare Workers",
    models: {
      articles: {
        columns: Article.columns_list.map { |col| { name: col[:name], type: col[:type] } },
        validations: Article.validations_list.map { |v| { field: v[:name], rules: v[:opts] } },
        endpoints: ["GET /api/articles", "GET /api/articles/:id", "POST /api/articles", "PUT /api/articles/:id", "DELETE /api/articles/:id"]
      },
      tags: {
        columns: Tag.columns_list.map { |col| { name: col[:name], type: col[:type] } },
        endpoints: ["GET /api/tags", "GET /api/tags/:id", "POST /api/tags", "PUT /api/tags/:id", "DELETE /api/tags/:id"]
      }
    },
    powered_by: "Homura::Model + mruby-metaprog"
  })
end

$app.get "/api/test-gems" do |c|
  c.json({
    metaprog: Article.respond_to?(:where),
    model_columns: Article.columns_list.length,
    model_validations: Article.validations_list.length
  })
end
