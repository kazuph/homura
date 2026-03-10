import { expect, test } from "@playwright/test";

test.describe("dsl-api", () => {
  test("exposes CRUD routes with model metadata", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "DSL API Builder" })).toBeVisible();

    const homeResponse = await request.get("/api");
    expect(homeResponse.status()).toBe(200);
    const home = await homeResponse.json();
    expect(home.name).toBe("DSL-Driven API Builder");
    expect(home.models.articles.columns.some((column: { name: string }) => column.name === "title")).toBe(true);
    expect(home.models.tags.endpoints).toContain("GET /api/tags");

    await page.fill("#article-title", "UI Article");
    await page.fill("#article-author", "Playwright");
    await page.fill("#article-body", "Rendered from browser");
    await page.check("#article-published");
    await page.click("#save-article");
    await expect(page.locator("#article-feedback")).toContainText(/article/i);
    await expect(page.locator("#articles-list")).toContainText("UI Article");

    await page.fill("#tag-name", "ui-tag");
    await page.click("#create-tag");
    await expect(page.locator("#tags-list")).toContainText("ui-tag");
    await expect(page.locator("#metadata-output")).toContainText("DSL-Driven API Builder");

    const invalidCreateResponse = await request.post("/api/articles", {
      headers: {
        "content-type": "application/json",
      },
      data: { body: "Missing title" },
    });
    expect(invalidCreateResponse.status()).toBe(422);
    const invalidCreate = await invalidCreateResponse.json();
    expect(Array.isArray(invalidCreate.errors)).toBe(true);

    const createResponse = await request.post("/api/articles", {
      headers: {
        "content-type": "application/json",
      },
      data: {
        title: "Playwright Article",
        body: "Content body",
        author: "E2E",
        published: true,
      },
    });
    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json();
    expect(created.title).toBe("Playwright Article");
    expect(created.body).toBe("Content body");
    expect(created.author).toBe("E2E");
    expect(created.published).toBe(true);
    expect(typeof created.id).toBe("number");

    const listResponse = await request.get("/api/articles");
    expect(listResponse.status()).toBe(200);
    const list = await listResponse.json();
    expect(list.meta.page).toBe(1);
    expect(list.meta.per).toBe(20);
    expect(list.meta.total).toBeGreaterThanOrEqual(1);
    expect(list.data.some((article: { id: number; title: string }) => article.id === created.id && article.title === "Playwright Article")).toBe(true);

    const showResponse = await request.get(`/api/articles/${created.id}`);
    expect(showResponse.status()).toBe(200);
    const shown = await showResponse.json();
    expect(shown.id).toBe(created.id);
    expect(shown.title).toBe("Playwright Article");

    const updateResponse = await request.put(`/api/articles/${created.id}`, {
      headers: {
        "content-type": "application/json",
      },
      data: {
        title: "Updated Article",
        body: "Updated content",
        author: "E2E",
        published: false,
      },
    });
    expect(updateResponse.status()).toBe(200);
    const updated = await updateResponse.json();
    expect(updated.title).toBe("Updated Article");
    expect(updated.published).toBe(false);

    const deleteResponse = await request.delete(`/api/articles/${created.id}`);
    expect(deleteResponse.status()).toBe(200);
    expect(await deleteResponse.json()).toEqual({ ok: true, id: created.id });

    const gemsResponse = await request.get("/api/test-gems");
    expect(gemsResponse.status()).toBe(200);
    const gems = await gemsResponse.json();
    expect(gems.metaprog).toBe(true);
    expect(gems.model_columns).toBeGreaterThanOrEqual(7);
    expect(gems.model_validations).toBe(2);
  });
});
