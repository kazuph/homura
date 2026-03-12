import { expect, test } from "@playwright/test";

test.describe("todo-app ORM regression", () => {
  test("manages categories and todos through UI and ORM demo APIs", async ({ page, request }) => {
    const resetResponse = await request.post("/api/test/reset-db");
    expect(resetResponse.status()).toBe(200);

    await page.goto("/guide");
    await expect(page.getByRole("heading", { name: "Homura ORM Guide", exact: true })).toBeVisible();

    await page.goto("/categories");
    await expect(page.getByRole("heading", { name: "Categories", exact: true })).toBeVisible();
    await page.fill('input[name="name"]', "Work");
    await page.fill('input[name="color"]', "#0f766e");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.locator(".cat-list")).toContainText("Work");

    await page.goto("/todos/new");
    await expect(page.getByRole("heading", { name: "New Todo", exact: true })).toBeVisible();
    await page.fill('input[name="title"]', "Ship ORM PR");
    await page.fill('textarea[name="description"]', "Add regression coverage for the todo app");
    await page.selectOption('select[name="priority"]', "3");
    await page.selectOption('select[name="category_id"]', { label: "Work" });
    await page.getByRole("button", { name: "Create Todo" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".todo-list")).toContainText("Ship ORM PR");
    await expect(page.locator(".todo-list")).toContainText("High");
    await expect(page.locator(".todo-list")).toContainText("Work");

    await page.goto("/categories");
    await expect(page.locator(".cat-list")).toContainText("1 todos");
    await page.goto("/");

    await page.fill("#quick-title", "Write Playwright coverage");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.locator(".todo-list")).toContainText("Write Playwright coverage");

    const listResponse = await request.get("/api/todos");
    expect(listResponse.status()).toBe(200);
    const listed = await listResponse.json();
    const todos = listed.data as Array<{ id: number; title: string; status: number }>;
    const seededTodo = todos.find((todo) => todo.title === "Ship ORM PR");
    const quickTodo = todos.find((todo) => todo.title === "Write Playwright coverage");
    expect(seededTodo).toBeTruthy();
    expect(quickTodo).toBeTruthy();

    const quickTodoItem = page.locator('.todo-item', { hasText: "Write Playwright coverage" });
    await quickTodoItem.locator('[data-toggle]').click();
    await expect(quickTodoItem).toContainText("In Progress");

    const seededTodoItem = page.locator('.todo-item', { hasText: "Ship ORM PR" });
    await seededTodoItem.getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL(/\/todos\/\d+\/edit$/);
    await page.fill('input[name="title"]', "Ship ORM PR safely");
    await page.selectOption('select[name="status"]', "2");
    await page.getByRole("button", { name: "Update Todo" }).click();

    await expect(page).toHaveURL(/\/$/);
    const updatedSeededTodoItem = page.locator('.todo-item', { hasText: "Ship ORM PR safely" });
    await expect(updatedSeededTodoItem).toContainText("Done");

    await page.getByRole("link", { name: /Done/ }).click();
    await expect(page).toHaveURL(/status=done/);
    await expect(page.locator(".todo-item")).toHaveCount(1);
    await expect(page.locator(".todo-list")).toContainText("Ship ORM PR safely");

    await page.getByRole("link", { name: "Work" }).click();
    await expect(page).toHaveURL(/category=/);
    await expect(page.locator(".todo-item")).toHaveCount(1);
    await expect(page.locator(".todo-list")).toContainText("Ship ORM PR safely");

    await page.goto("/");

    const statsResponse = await request.get("/api/stats");
    expect(statsResponse.status()).toBe(200);
    const stats = await statsResponse.json();
    expect(stats.total).toBe(2);
    expect(stats.pending).toBe(0);
    expect(stats.in_progress).toBe(1);
    expect(stats.done).toBe(1);
    expect(stats.high_priority).toBe(1);
    expect(stats.categories).toBe(1);

    const titlesResponse = await request.get("/api/todos/pluck-titles");
    expect(titlesResponse.status()).toBe(200);
    const titles = await titlesResponse.json();
    expect(titles.titles).toEqual(["Ship ORM PR safely", "Write Playwright coverage"]);

    const existsResponse = await request.get("/api/todos/query/exists?title=Ship%20ORM%20PR%20safely");
    expect(existsResponse.status()).toBe(200);
    const exists = await existsResponse.json();
    expect(exists.exists).toBe(true);

    const dirtyResponse = await request.put(`/api/todos/${seededTodo!.id}/track-changes`, {
      headers: {
        "content-type": "application/json",
      },
      data: { title: "Ship ORM PR via dirty tracking" },
    });
    expect(dirtyResponse.status()).toBe(200);
    const dirty = await dirtyResponse.json();
    expect(dirty.before_changed).toBe(false);
    expect(dirty.after_changed).toBe(true);
    expect(dirty.title_changed).toBe(true);
    expect(dirty.title_was).toBe("Ship ORM PR safely");

    await quickTodoItem.locator('[data-del]').click();
    await expect(page.locator(".todo-list")).not.toContainText("Write Playwright coverage");

    const notDoneResponse = await request.get("/api/todos/not-done");
    expect(notDoneResponse.status()).toBe(200);
    const notDone = await notDoneResponse.json();
    expect(notDone.count).toBe(0);
  });

  test("keeps find_or_create_by idempotent and ids in sync", async ({ request }) => {
    const resetResponse = await request.post("/api/test/reset-db");
    expect(resetResponse.status()).toBe(200);

    const firstResponse = await request.post("/api/todos/find-or-create", {
      headers: {
        "content-type": "application/json",
      },
      data: {
        title: "Document trace workflow",
        description: "Regression helper",
        priority: 2,
      },
    });
    expect(firstResponse.status()).toBe(200);
    const firstTodo = await firstResponse.json();
    expect(firstTodo.title).toBe("Document trace workflow");

    const secondResponse = await request.post("/api/todos/find-or-create", {
      headers: {
        "content-type": "application/json",
      },
      data: {
        title: "Document trace workflow",
        description: "Regression helper",
        priority: 2,
      },
    });
    expect(secondResponse.status()).toBe(200);
    const secondTodo = await secondResponse.json();
    expect(secondTodo.id).toBe(firstTodo.id);

    const idsResponse = await request.get("/api/todos/ids");
    expect(idsResponse.status()).toBe(200);
    const ids = await idsResponse.json();
    expect(ids.ids).toEqual([firstTodo.id]);
  });
});
