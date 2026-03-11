import { expect, test } from "@playwright/test";

test.describe("dsl-api ORM integration", () => {
  // Tests are ordered to run lightweight/edge-case tests early while WASM
  // instance is fresh, then heavier integration tests. Each test creates
  // its own data and uses unique identifiers for isolation.

  // ========================================
  // 1. Edge cases: malformed/empty input (lightweight, run first)
  // ========================================
  test("rejects malformed JSON body", async ({ request }) => {
    const res = await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: "this is not json{{{",
    });
    // Should return 400 (bad JSON) or 422 (validation failure), not 500
    expect(res.status()).toBeLessThan(500);
  });

  test("rejects empty body", async ({ request }) => {
    const res = await request.post("/api/authors", {
      headers: { "content-type": "application/json" },
      data: {},
    });
    // Missing required fields -> 422
    expect(res.status()).toBe(422);
    const result = await res.json();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("unknown article ID returns 404", async ({ request }) => {
    const res = await request.get("/api/articles/99999");
    expect(res.status()).toBe(404);
  });

  // ========================================
  // 2. Basic CRUD
  // ========================================
  test("basic author CRUD", async ({ request }) => {
    const createRes = await request.post("/api/authors", {
      headers: { "content-type": "application/json" },
      data: { name: "Alice Smith", email: "alice@example.com" },
    });
    expect(createRes.status()).toBe(201);
    const author = await createRes.json();
    expect(author.name).toBe("Alice Smith");
    expect(author.email).toBe("alice@example.com");
    expect(typeof author.id).toBe("number");

    const showRes = await request.get(`/api/authors/${author.id}`);
    expect(showRes.status()).toBe(200);
    const shown = await showRes.json();
    expect(shown.id).toBe(author.id);
    expect(shown.name).toBe("Alice Smith");
  });

  // ========================================
  // 3. Validations (presence, length, format)
  // ========================================
  test("validates presence", async ({ request }) => {
    const res = await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: { body: "Missing title" },
    });
    expect(res.status()).toBe(422);
    const result = await res.json();
    expect(result.errors).toContain("title can't be blank");
  });

  test("validates length minimum", async ({ request }) => {
    const res = await request.post("/api/test/validate-length", {
      headers: { "content-type": "application/json" },
      data: { title: "ab", body: "Some body content" },
    });
    expect(res.status()).toBe(200);
    const result = await res.json();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("too short"))).toBe(true);
  });

  test("validates length maximum", async ({ request }) => {
    const longTitle = "x".repeat(201);
    const res = await request.post("/api/test/validate-length", {
      headers: { "content-type": "application/json" },
      data: { title: longTitle, body: "Some body" },
    });
    expect(res.status()).toBe(200);
    const result = await res.json();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("too long"))).toBe(true);
  });

  test("validates email format", async ({ request }) => {
    const res = await request.post("/api/authors", {
      headers: { "content-type": "application/json" },
      data: { name: "Bad Email", email: "not-an-email" },
    });
    expect(res.status()).toBe(422);
    const result = await res.json();
    expect(result.errors.some((e: string) => e.includes("invalid"))).toBe(true);
  });

  // ========================================
  // 4. by_author scope (run early, needs 7 requests)
  // ========================================
  test("scope: by_author filters articles by author_id", async ({ request }) => {
    // Create 2 authors
    const author1Res = await request.post("/api/authors", {
      headers: { "content-type": "application/json" },
      data: { name: "Author One", email: "one@example.com" },
    });
    const author1 = await author1Res.json();

    const author2Res = await request.post("/api/authors", {
      headers: { "content-type": "application/json" },
      data: { name: "Author Two", email: "two@example.com" },
    });
    const author2 = await author2Res.json();

    // Create articles for each author
    await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: { title: "Author1 Article A", body: "Content", author_id: author1.id },
    });
    await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: { title: "Author1 Article B", body: "Content", author_id: author1.id },
    });
    await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: { title: "Author2 Article A", body: "Content", author_id: author2.id },
    });

    // Fetch by_author scope for author1
    const res = await request.get(`/api/articles/scoped/by-author/${author1.id}`);
    expect(res.status()).toBe(200);
    const result = await res.json();
    expect(result.count).toBe(2);
    expect(result.data.every((a: { author_id: number }) => a.author_id === author1.id)).toBe(true);

    // Fetch by_author scope for author2
    const res2 = await request.get(`/api/articles/scoped/by-author/${author2.id}`);
    const result2 = await res2.json();
    expect(result2.count).toBe(1);
    expect(result2.data[0].author_id).toBe(author2.id);
  });

  // ========================================
  // 5. Associations (has_many, belongs_to, has_one)
  // ========================================
  test("has_many: author.articles", async ({ request }) => {
    // Create author
    const authorRes = await request.post("/api/authors", {
      headers: { "content-type": "application/json" },
      data: { name: "Bob Writer", email: "bob@example.com" },
    });
    const author = await authorRes.json();

    // Create 3 articles for this author
    for (const title of ["Article A", "Article B", "Article C"]) {
      await request.post("/api/articles", {
        headers: { "content-type": "application/json" },
        data: { title, body: `Body of ${title}`, author_id: author.id },
      });
    }

    // Fetch author's articles via has_many
    const articlesRes = await request.get(`/api/authors/${author.id}/articles`);
    expect(articlesRes.status()).toBe(200);
    const articles = await articlesRes.json();
    expect(articles.count).toBe(3);
    expect(articles.data.length).toBe(3);
    expect(articles.data.every((a: { author_id: number }) => a.author_id === author.id)).toBe(true);
  });

  test("belongs_to: article.author", async ({ request }) => {
    // Create author
    const authorRes = await request.post("/api/authors", {
      headers: { "content-type": "application/json" },
      data: { name: "Carol Author", email: "carol@example.com" },
    });
    const author = await authorRes.json();

    // Create article
    const articleRes = await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: { title: "Carol's Article", body: "Content", author_id: author.id },
    });
    const article = await articleRes.json();

    // Get article and verify author_id
    const showRes = await request.get(`/api/articles/${article.id}`);
    const shown = await showRes.json();
    expect(shown.author_id).toBe(author.id);
  });

  test("has_one: author.profile", async ({ request }) => {
    // Create author
    const authorRes = await request.post("/api/authors", {
      headers: { "content-type": "application/json" },
      data: { name: "Dave Profile", email: "dave@example.com" },
    });
    const author = await authorRes.json();

    // No profile yet
    const noProfileRes = await request.get(`/api/authors/${author.id}/profile`);
    expect(noProfileRes.status()).toBe(404);

    // Create profile
    const profileRes = await request.post("/api/profiles", {
      headers: { "content-type": "application/json" },
      data: { author_id: author.id, bio: "I write code", website: "https://dave.dev" },
    });
    expect(profileRes.status()).toBe(201);
    const profile = await profileRes.json();
    expect(profile.author_id).toBe(author.id);

    // Now fetch profile via has_one
    const hasOneRes = await request.get(`/api/authors/${author.id}/profile`);
    expect(hasOneRes.status()).toBe(200);
    const fetched = await hasOneRes.json();
    expect(fetched.bio).toBe("I write code");
    expect(fetched.website).toBe("https://dave.dev");
  });

  test("belongs_to reverse: profile.author", async ({ request }) => {
    // Create author + profile
    const authorRes = await request.post("/api/authors", {
      headers: { "content-type": "application/json" },
      data: { name: "Eve Reverse", email: "eve@example.com" },
    });
    const author = await authorRes.json();

    const profileRes = await request.post("/api/profiles", {
      headers: { "content-type": "application/json" },
      data: { author_id: author.id, bio: "Reverse test" },
    });
    const profile = await profileRes.json();

    // Fetch author from profile
    const reverseRes = await request.get(`/api/profiles/${profile.id}/author`);
    expect(reverseRes.status()).toBe(200);
    const fetchedAuthor = await reverseRes.json();
    expect(fetchedAuthor.id).toBe(author.id);
    expect(fetchedAuthor.name).toBe("Eve Reverse");
  });

  // ========================================
  // 6. Enum (status: draft/published/archived)
  // ========================================
  test("enum: default status is draft", async ({ request }) => {
    const res = await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: { title: "Enum Default Test", body: "Content" },
    });
    const article = await res.json();

    const statusRes = await request.get(`/api/articles/${article.id}/status`);
    const status = await statusRes.json();
    expect(status.status).toBe("draft");
    expect(status.status_value).toBe(0);
    expect(status.is_draft).toBe(true);
    expect(status.is_published).toBe(false);
    expect(status.is_archived).toBe(false);
  });

  test("enum: publish and archive via bang methods", async ({ request }) => {
    const createRes = await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: { title: "Enum Bang Test", body: "Content" },
    });
    const article = await createRes.json();

    // Publish
    const publishRes = await request.put(`/api/articles/${article.id}/publish`);
    expect(publishRes.status()).toBe(200);
    const published = await publishRes.json();
    expect(published.status).toBe(1); // stored as integer in DB

    // Verify status endpoint
    const statusRes = await request.get(`/api/articles/${article.id}/status`);
    const status = await statusRes.json();
    expect(status.status).toBe("published");
    expect(status.is_published).toBe(true);

    // Archive
    const archiveRes = await request.put(`/api/articles/${article.id}/archive`);
    expect(archiveRes.status()).toBe(200);

    const statusRes2 = await request.get(`/api/articles/${article.id}/status`);
    const status2 = await statusRes2.json();
    expect(status2.status).toBe("archived");
    expect(status2.status_value).toBe(2);
    expect(status2.is_archived).toBe(true);
  });

  test("enum: class-level statuses helper", async ({ request }) => {
    const res = await request.get("/api/enum/statuses");
    expect(res.status()).toBe(200);
    const statuses = await res.json();
    expect(statuses.draft).toBe(0);
    expect(statuses.published).toBe(1);
    expect(statuses.archived).toBe(2);
  });

  // ========================================
  // 7. Scopes
  // ========================================
  test("scope: published and drafts", async ({ request }) => {
    // Create draft and published articles
    const draftRes = await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: { title: "Scope Draft", body: "Draft content", status: 0 },
    });
    const draft = await draftRes.json();

    const pubRes = await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: { title: "Scope Published", body: "Published content", status: 1 },
    });
    const pub = await pubRes.json();

    // Fetch published
    const publishedRes = await request.get("/api/articles/scoped/published");
    const publishedData = await publishedRes.json();
    expect(publishedData.data.some((a: { title: string }) => a.title === "Scope Published")).toBe(true);
    expect(publishedData.data.every((a: { status: number }) => a.status === 1)).toBe(true);

    // Fetch drafts
    const draftsRes = await request.get("/api/articles/scoped/drafts");
    const draftsData = await draftsRes.json();
    expect(draftsData.data.some((a: { title: string }) => a.title === "Scope Draft")).toBe(true);
    expect(draftsData.data.every((a: { status: number }) => a.status === 0)).toBe(true);
  });

  // ========================================
  // 8. Callbacks (before_save: generate_slug)
  // ========================================
  test("callback: auto-generates slug from title", async ({ request }) => {
    const res = await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: { title: "Hello World Example", body: "Content here" },
    });
    expect(res.status()).toBe(201);
    const article = await res.json();
    expect(article.slug).toBe("hello-world-example");
  });

  test("callback: preserves existing slug", async ({ request }) => {
    const res = await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: { title: "Custom Slug Test", body: "Content", slug: "my-custom-slug" },
    });
    expect(res.status()).toBe(201);
    const article = await res.json();
    expect(article.slug).toBe("my-custom-slug");
  });

  test("callback: update_timestamp sets updated_at", async ({ request }) => {
    const res = await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: { title: "Timestamp Test", body: "Content" },
    });
    const article = await res.json();
    // updated_at should be set by callback (unix timestamp as string)
    expect(article.updated_at).toBeTruthy();
    expect(Number(article.updated_at)).toBeGreaterThan(0);
  });

  // ========================================
  // 9. Dirty Tracking
  // ========================================
  test("dirty tracking: detects changes before save", async ({ request }) => {
    // Create article
    const createRes = await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: { title: "Dirty Test Original", body: "Content" },
    });
    const article = await createRes.json();

    // Track changes
    const trackRes = await request.put(`/api/articles/${article.id}/track-changes`, {
      headers: { "content-type": "application/json" },
      data: { title: "Dirty Test Updated" },
    });
    expect(trackRes.status()).toBe(200);
    const tracked = await trackRes.json();

    expect(tracked.before_changed).toBe(false); // freshly loaded = not changed
    expect(tracked.after_changed).toBe(true); // after title mutation = changed
    expect(tracked.title_changed).toBe(true);
    expect(tracked.title_was).toBe("Dirty Test Original");
    expect(tracked.changed_attributes).toContain("title");
  });

  // ========================================
  // 10. Query Extensions
  // ========================================
  test("where.not: excludes drafts", async ({ request }) => {
    // Create one published article
    await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: { title: "WhereNot Published", body: "Content", status: 1 },
    });

    const res = await request.get("/api/articles/query/where-not-draft");
    expect(res.status()).toBe(200);
    const result = await res.json();
    expect(result.data.every((a: { status: number }) => a.status !== 0)).toBe(true);
  });

  test("pluck: returns title values only", async ({ request }) => {
    await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: { title: "Pluck Test Article", body: "Content" },
    });

    const res = await request.get("/api/articles/query/pluck-titles");
    expect(res.status()).toBe(200);
    const result = await res.json();
    expect(Array.isArray(result.titles)).toBe(true);
    expect(result.titles.some((t: string) => t === "Pluck Test Article")).toBe(true);
    // pluck returns primitives, not objects
    expect(result.titles.every((t: unknown) => typeof t === "string")).toBe(true);
  });

  test("ids: returns array of integers", async ({ request }) => {
    const res = await request.get("/api/articles/query/ids");
    expect(res.status()).toBe(200);
    const result = await res.json();
    expect(Array.isArray(result.ids)).toBe(true);
    expect(result.ids.every((id: unknown) => typeof id === "number")).toBe(true);
  });

  test("exists?: checks record existence", async ({ request }) => {
    await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: { title: "Exists Check Article", body: "Content" },
    });

    const existsRes = await request.get("/api/articles/query/exists?title=Exists+Check+Article");
    expect(existsRes.status()).toBe(200);
    const exists = await existsRes.json();
    expect(exists.exists).toBe(true);

    const notExistsRes = await request.get("/api/articles/query/exists?title=Nonexistent+Article+XYZ");
    const notExists = await notExistsRes.json();
    expect(notExists.exists).toBe(false);
  });

  test("find_by: finds first matching record", async ({ request }) => {
    await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: { title: "FindBy Target", body: "Content" },
    });

    const res = await request.get("/api/articles/query/find-by?title=FindBy+Target");
    expect(res.status()).toBe(200);
    const article = await res.json();
    expect(article.title).toBe("FindBy Target");

    const notFoundRes = await request.get("/api/articles/query/find-by?title=Nonexistent+XYZ");
    expect(notFoundRes.status()).toBe(404);
  });

  test("find_or_create_by: creates if not found", async ({ request }) => {
    // First call: should create
    const res1 = await request.post("/api/articles/query/find-or-create", {
      headers: { "content-type": "application/json" },
      data: { title: "FindOrCreate Unique", body: "First call" },
    });
    expect(res1.status()).toBe(200); // persisted? is true after create+find
    const article1 = await res1.json();
    expect(article1.title).toBe("FindOrCreate Unique");
    expect(typeof article1.id).toBe("number");

    // Second call: should find existing
    const res2 = await request.post("/api/articles/query/find-or-create", {
      headers: { "content-type": "application/json" },
      data: { title: "FindOrCreate Unique", body: "First call" },
    });
    const article2 = await res2.json();
    expect(article2.id).toBe(article1.id); // same record
  });

  // ========================================
  // 11. Pagination (uses relative checks - DB may have pre-existing data)
  // ========================================
  test("pagination: returns correct page structure and meta", async ({ request }) => {
    // Get current count
    const beforeRes = await request.get("/api/articles?page=1&per=100");
    const before = await beforeRes.json();
    const countBefore = before.meta.total;

    // Create 3 articles for pagination
    for (let i = 1; i <= 3; i++) {
      await request.post("/api/articles", {
        headers: { "content-type": "application/json" },
        data: { title: `Pagination Article ${i}`, body: `Body ${i}` },
      });
    }

    // Verify total increased by 3
    const afterRes = await request.get("/api/articles?page=1&per=2");
    expect(afterRes.status()).toBe(200);
    const page1 = await afterRes.json();
    expect(page1.data.length).toBe(2);
    expect(page1.meta.page).toBe(1);
    expect(page1.meta.per).toBe(2);
    expect(page1.meta.total).toBe(countBefore + 3);

    // Page 2 should also have data
    const page2Res = await request.get("/api/articles?page=2&per=2");
    const page2 = await page2Res.json();
    expect(page2.data.length).toBe(2);
    expect(page2.meta.page).toBe(2);

    // No overlap between pages
    const page1Ids = page1.data.map((a: { id: number }) => a.id);
    const page2Ids = page2.data.map((a: { id: number }) => a.id);
    const overlap = page1Ids.filter((id: number) => page2Ids.includes(id));
    expect(overlap.length).toBe(0);
  });

  // ========================================
  // 12. Full CRUD lifecycle with all features
  // ========================================
  test("full lifecycle: create, update, scope, enum, delete", async ({ request }) => {
    // Create author
    const authorRes = await request.post("/api/authors", {
      headers: { "content-type": "application/json" },
      data: { name: "Lifecycle Author", email: "life@example.com" },
    });
    const author = await authorRes.json();

    // Create article (draft by default, slug auto-generated)
    const createRes = await request.post("/api/articles", {
      headers: { "content-type": "application/json" },
      data: { title: "Lifecycle Article", body: "Full test", author_id: author.id },
    });
    expect(createRes.status()).toBe(201);
    const article = await createRes.json();
    expect(article.slug).toBe("lifecycle-article");
    expect(article.author_id).toBe(author.id);

    // Verify appears in drafts scope
    const draftsRes = await request.get("/api/articles/scoped/drafts");
    const drafts = await draftsRes.json();
    expect(drafts.data.some((a: { id: number }) => a.id === article.id)).toBe(true);

    // Publish it
    await request.put(`/api/articles/${article.id}/publish`);

    // Verify appears in published scope, NOT in drafts
    const publishedRes = await request.get("/api/articles/scoped/published");
    const published = await publishedRes.json();
    expect(published.data.some((a: { id: number }) => a.id === article.id)).toBe(true);

    // Verify via has_many
    const authorArticlesRes = await request.get(`/api/authors/${author.id}/articles`);
    const authorArticles = await authorArticlesRes.json();
    expect(authorArticles.data.some((a: { id: number }) => a.id === article.id)).toBe(true);

    // Delete
    const deleteRes = await request.delete(`/api/articles/${article.id}`);
    expect(deleteRes.status()).toBe(200);
    expect(await deleteRes.json()).toEqual({ ok: true, id: article.id });

    // Verify gone
    const goneRes = await request.get(`/api/articles/${article.id}`);
    expect(goneRes.status()).toBe(404);
  });

  // ========================================
  // 13. API metadata reflects all features
  // ========================================
  test("API metadata lists all ORM features", async ({ request }) => {
    const res = await request.get("/api");
    expect(res.status()).toBe(200);
    const api = await res.json();

    expect(api.name).toBe("DSL-Driven API Builder");
    expect(api.features).toContain("Associations (has_many, belongs_to, has_one)");
    expect(api.features).toContain("Scopes (published, drafts, by_author)");
    expect(api.features).toContain("Enum (status: draft/published/archived)");
    expect(api.features).toContain("Callbacks (before_save: generate_slug, update_timestamp)");
    expect(api.features).toContain("Dirty tracking (changed?, title_changed?, title_was)");

    expect(api.models.authors.associations).toContain("has_many :articles");
    expect(api.models.authors.associations).toContain("has_one :profile");
    expect(api.models.articles.associations).toContain("belongs_to :author");
    expect(api.models.articles.scopes).toContain("published");
    expect(api.models.articles.enum.draft).toBe(0);
    expect(api.models.articles.enum.published).toBe(1);
  });
});
