# DSL-Driven API Builder - Route Definitions
# Model definitions are in app/models.rb (loaded with core+model in single eval)

# ===== Authors CRUD =====

$app.get "/api/authors" do |c|
  authors = Author.order("id DESC").all(c.db)
  c.json({ data: authors.map { |a| a.to_h } })
end

$app.post "/api/authors" do |c|
  body = c.json_body
  unless body.is_a?(Hash)
    c.json({ error: "JSON body required" }, status: 400)
  else
    author = Author.new(body)
    if author.valid?
      author.save(c.db)
      c.json(author.to_h, status: 201)
    else
      c.json({ errors: author.errors }, status: 422)
    end
  end
end

$app.get "/api/authors/:id" do |c|
  id = c.req.param("id").to_i
  author = Author.find(c.db, id)
  unless author
    c.json({ error: "Not found" }, status: 404)
  else
    c.json(author.to_h)
  end
end

# GET /api/authors/:id/articles - has_many association
$app.get "/api/authors/:id/articles" do |c|
  id = c.req.param("id").to_i
  author = Author.find(c.db, id)
  unless author
    c.json({ error: "Author not found" }, status: 404)
  else
    articles = author.articles(c.db)
    c.json({ data: articles.map { |a| a.to_h }, count: articles.length })
  end
end

# GET /api/authors/:id/profile - has_one association
$app.get "/api/authors/:id/profile" do |c|
  id = c.req.param("id").to_i
  author = Author.find(c.db, id)
  unless author
    c.json({ error: "Author not found" }, status: 404)
  else
    profile = author.profile(c.db)
    if profile
      c.json(profile.to_h)
    else
      c.json({ error: "No profile" }, status: 404)
    end
  end
end

# ===== Profiles CRUD =====

$app.post "/api/profiles" do |c|
  body = c.json_body
  unless body.is_a?(Hash)
    c.json({ error: "JSON body required" }, status: 400)
  else
    profile = Profile.new(body)
    if profile.valid?
      profile.save(c.db)
      c.json(profile.to_h, status: 201)
    else
      c.json({ errors: profile.errors }, status: 422)
    end
  end
end

# GET /api/profiles/:id/author - belongs_to association
$app.get "/api/profiles/:id/author" do |c|
  id = c.req.param("id").to_i
  profile = Profile.find(c.db, id)
  unless profile
    c.json({ error: "Profile not found" }, status: 404)
  else
    author = profile.author(c.db)
    if author
      c.json(author.to_h)
    else
      c.json({ error: "Author not found" }, status: 404)
    end
  end
end

# ===== Articles CRUD =====

$app.get "/api/articles" do |c|
  page = (c.req.query("page") || "1").to_i
  per = (c.req.query("per") || "20").to_i
  offset = (page - 1) * per

  query = Article.order("id DESC").limit(per)
  query = query.offset(offset) if offset > 0
  records = query.all(c.db)
  total = Article.where({}).count(c.db)

  c.json({
    data: records.map { |r| r.to_h },
    meta: { page: page, per: per, total: total }
  })
end

$app.get "/api/articles/:id" do |c|
  id = c.req.param("id").to_i
  article = Article.find(c.db, id)
  if article
    c.json(article.to_h)
  else
    c.json({ error: "Not found" }, status: 404)
  end
end

$app.post "/api/articles" do |c|
  body = c.json_body
  unless body.is_a?(Hash)
    c.json({ error: "JSON body required" }, status: 400)
  else
    article = Article.new(body)
    if article.valid?
      article.save(c.db)
      c.json(article.to_h, status: 201)
    else
      c.json({ errors: article.errors }, status: 422)
    end
  end
end

$app.put "/api/articles/:id" do |c|
  id = c.req.param("id").to_i
  article = Article.find(c.db, id)
  unless article
    c.json({ error: "Not found" }, status: 404)
  else
    body = c.json_body || {}
    article.update_attrs(c.db, body)
    c.json(article.to_h)
  end
end

$app.delete "/api/articles/:id" do |c|
  id = c.req.param("id").to_i
  article = Article.find(c.db, id)
  unless article
    c.json({ error: "Not found" }, status: 404)
  else
    article.destroy(c.db)
    c.json({ ok: true, id: id })
  end
end

# ===== Scoped queries =====

# GET /api/articles/scoped/published - scope test
$app.get "/api/articles/scoped/published" do |c|
  articles = Article.published.order("id DESC").all(c.db)
  c.json({ data: articles.map { |a| a.to_h }, count: articles.length })
end

# GET /api/articles/scoped/drafts - scope test
$app.get "/api/articles/scoped/drafts" do |c|
  articles = Article.drafts.order("id DESC").all(c.db)
  c.json({ data: articles.map { |a| a.to_h }, count: articles.length })
end

# ===== Enum endpoints =====

# PUT /api/articles/:id/publish - enum bang
$app.put "/api/articles/:id/publish" do |c|
  id = c.req.param("id").to_i
  article = Article.find(c.db, id)
  unless article
    c.json({ error: "Not found" }, status: 404)
  else
    article.published!
    article.save(c.db)
    c.json(article.to_h)
  end
end

# PUT /api/articles/:id/archive - enum bang
$app.put "/api/articles/:id/archive" do |c|
  id = c.req.param("id").to_i
  article = Article.find(c.db, id)
  unless article
    c.json({ error: "Not found" }, status: 404)
  else
    article.archived!
    article.save(c.db)
    c.json(article.to_h)
  end
end

# GET /api/articles/:id/status - enum info
$app.get "/api/articles/:id/status" do |c|
  id = c.req.param("id").to_i
  article = Article.find(c.db, id)
  unless article
    c.json({ error: "Not found" }, status: 404)
  else
    c.json({
      status: article.status.to_s,
      status_value: article.status_value,
      is_draft: article.draft?,
      is_published: article.published?,
      is_archived: article.archived?
    })
  end
end

# GET /api/enum/statuses - class-level enum helper
$app.get "/api/enum/statuses" do |c|
  c.json(Article.statuses)
end

# ===== Query extensions =====

# GET /api/articles/query/where-not-draft - where.not
$app.get "/api/articles/query/where-not-draft" do |c|
  articles = Article.where.not(status: 0).order("id DESC").all(c.db)
  c.json({ data: articles.map { |a| a.to_h }, count: articles.length })
end

# GET /api/articles/query/pluck-titles - pluck
$app.get "/api/articles/query/pluck-titles" do |c|
  titles = Article.order("id ASC").pluck(:title, c.db)
  c.json({ titles: titles })
end

# GET /api/articles/query/ids - ids
$app.get "/api/articles/query/ids" do |c|
  ids = Article.order("id ASC").ids(c.db)
  c.json({ ids: ids })
end

# GET /api/articles/query/exists - exists?
$app.get "/api/articles/query/exists" do |c|
  title = c.req.query("title") || ""
  exists = Article.where(title: title).exists?(c.db)
  c.json({ exists: exists })
end

# GET /api/articles/query/find-by - find_by
$app.get "/api/articles/query/find-by" do |c|
  title = c.req.query("title") || ""
  article = Article.find_by(c.db, title: title)
  if article
    c.json(article.to_h)
  else
    c.json({ error: "Not found" }, status: 404)
  end
end

# POST /api/articles/query/find-or-create - find_or_create_by
$app.post "/api/articles/query/find-or-create" do |c|
  body = c.json_body || {}
  article = Article.find_or_create_by(c.db, body)
  if article
    c.json(article.to_h, status: article.persisted? ? 200 : 201)
  else
    c.json({ error: "Failed" }, status: 500)
  end
end

# ===== Dirty tracking endpoint =====

# PUT /api/articles/:id/track-changes - dirty tracking test
$app.put "/api/articles/:id/track-changes" do |c|
  id = c.req.param("id").to_i
  article = Article.find(c.db, id)
  unless article
    c.json({ error: "Not found" }, status: 404)
  else
    before_changed = article.changed?
    old_title = article.title

    body = c.json_body || {}
    new_title = body["title"] || body[:title]
    article.title = new_title if new_title

    c.json({
      before_changed: before_changed,
      after_changed: article.changed?,
      title_changed: article.title_changed?,
      title_was: article.title_was,
      changes: article.changes.to_h,
      changed_attributes: article.changed_attributes
    })
  end
end

# ===== Validation test endpoints =====

# POST /api/test/validate-length
$app.post "/api/test/validate-length" do |c|
  body = c.json_body || {}
  article = Article.new(body)
  c.json({ valid: article.valid?, errors: article.errors })
end

# ===== Tags CRUD =====

$app.get "/api/tags" do |c|
  tags = Tag.order("id DESC").all(c.db)
  c.json({ data: tags.map { |t| t.to_h } })
end

$app.post "/api/tags" do |c|
  body = c.json_body
  unless body.is_a?(Hash)
    c.json({ error: "JSON body required" }, status: 400)
  else
    tag = Tag.new(body)
    if tag.valid?
      tag.save(c.db)
      c.json(tag.to_h, status: 201)
    else
      c.json({ errors: tag.errors }, status: 422)
    end
  end
end

# ===== Home + API docs =====

$app.get "/" do |c|
  c.jsx("home", {})
end

$app.get "/api" do |c|
  c.json({
    name: "DSL-Driven API Builder",
    description: "Full ActiveRecord-style ORM on Cloudflare Workers",
    features: [
      "Associations (has_many, belongs_to, has_one)",
      "Scopes (published, drafts, by_author)",
      "Enum (status: draft/published/archived)",
      "Callbacks (before_save: generate_slug, update_timestamp)",
      "Dirty tracking (changed?, title_changed?, title_was)",
      "Validations (presence, length, format)",
      "Query extensions (where.not, pluck, ids, exists?, find_by, find_or_create_by)"
    ],
    models: {
      authors: {
        columns: Author.columns_list.map { |col| { name: col[:name], type: col[:type] } },
        associations: ["has_many :articles", "has_one :profile"]
      },
      articles: {
        columns: Article.columns_list.map { |col| { name: col[:name], type: col[:type] } },
        associations: ["belongs_to :author"],
        scopes: ["published", "drafts", "by_author(id)"],
        enum: Article.statuses,
        callbacks: ["before_save :generate_slug", "before_save :update_timestamp"]
      },
      profiles: {
        columns: Profile.columns_list.map { |col| { name: col[:name], type: col[:type] } },
        associations: ["belongs_to :author"]
      },
      tags: {
        columns: Tag.columns_list.map { |col| { name: col[:name], type: col[:type] } }
      }
    },
    powered_by: "Homura::Model ORM + mruby-metaprog + mruby-time"
  })
end
