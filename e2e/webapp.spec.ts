import { expect, test } from "@playwright/test";

test.describe("webapp", () => {
  test("home page and todos API work end-to-end", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Homura To-Do" })).toBeVisible();
    await expect(page.locator("#todo-input")).toBeVisible();

    for (let index = 0; index < 12; index += 1) {
      await page.fill("#todo-input", `UI todo ${index}`);
      await page.click("#btn-add");
    }
    await expect(page.locator("#todo-list .todo-item")).toHaveCount(12);

    for (let index = 0; index < 4; index += 1) {
      await page.locator("#todo-list .todo-item input[type='checkbox']").nth(index).check();
      await page.locator("#todo-list .todo-item input[type='checkbox']").nth(index).uncheck();
    }

    for (let index = 0; index < 3; index += 1) {
      await page.locator("#todo-list .todo-delete").nth(0).click();
    }
    await expect(page.locator("#todo-list .todo-item")).toHaveCount(9);

    await page.fill("#todo-input", "UI todo after delete");
    await page.click("#btn-add");
    await expect(page.locator("#todo-list")).toContainText("UI todo after delete");

    const listBefore = await request.get("/api/todos");
    expect(listBefore.status()).toBe(200);
    const todosBefore = await listBefore.json();
    expect(Array.isArray(todosBefore)).toBe(true);

    const createResponse = await request.post("/api/todos", {
      headers: {
        "content-type": "application/json",
      },
      data: { title: "Playwright todo" },
    });
    expect(createResponse.status()).toBe(201);
    const createdTodo = await createResponse.json();
    expect(createdTodo.title).toBe("Playwright todo");
    expect(createdTodo.completed).toBe(false);
    expect(typeof createdTodo.id).toBe("number");

    const listAfter = await request.get("/api/todos");
    expect(listAfter.status()).toBe(200);
    const todosAfter = await listAfter.json();
    expect(Array.isArray(todosAfter)).toBe(true);
    expect(todosAfter.some((todo: { id: number; title: string }) => todo.id === createdTodo.id && todo.title === "Playwright todo")).toBe(true);

    const gemsResponse = await request.get("/api/test-gems");
    expect(gemsResponse.status()).toBe(200);
    const gems = await gemsResponse.json();
    expect(typeof gems.time_now).toBe("number");
    expect(gems.set_values).toEqual([1, 2, 3]);
    expect(gems.enumerator).toEqual([2, 4, 6]);
  });
});
