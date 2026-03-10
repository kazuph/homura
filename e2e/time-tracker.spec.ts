import { expect, test } from "@playwright/test";

test.describe("time-tracker", () => {
  test("creates events, aggregates stats, and issues time tokens", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Time Tracker" })).toBeVisible();

    const homeResponse = await request.get("/api");
    expect(homeResponse.status()).toBe(200);
    const home = await homeResponse.json();
    expect(home.name).toBe("Time Tracker");
    expect(Array.isArray(home.endpoints)).toBe(true);

    await page.fill("#event-name", "deploy-ui");
    await page.click("#create-event");
    await expect(page.locator("#event-feedback")).toContainText("deploy-ui");
    await expect(page.locator("#events-list")).toContainText("deploy-ui");

    await page.fill("#token-seed", "ui-seed");
    await page.click("#generate-token");
    await expect(page.locator("#token-card")).toContainText(/remaining/i);

    const createResponse = await request.post("/events", {
      headers: {
        "content-type": "application/json",
      },
      data: { name: "deploy" },
    });
    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json();
    expect(created.name).toBe("deploy");
    expect(typeof created.id).toBe("number");
    expect(typeof created.timestamp).toBe("number");

    const listResponse = await request.get("/events");
    expect(listResponse.status()).toBe(200);
    const listed = await listResponse.json();
    expect(listed.count).toBeGreaterThanOrEqual(1);
    expect(listed.events.some((event: { id: number; name: string }) => event.id === created.id && event.name === "deploy")).toBe(true);

    const statsResponse = await request.get("/events/stats");
    expect(statsResponse.status()).toBe(200);
    const stats = await statsResponse.json();
    const deployStat = stats.stats.find((entry: { name: string }) => entry.name === "deploy");
    expect(deployStat).toBeTruthy();
    expect(Number(deployStat.count)).toBeGreaterThanOrEqual(1);

    const tokenResponse = await request.get("/token?seed=e2e&window=30");
    expect(tokenResponse.status()).toBe(200);
    const token = await tokenResponse.json();
    expect(token.seed).toBe("e2e");
    expect(token.window_seconds).toBe(30);
    expect(token.token).toMatch(/^\d{6}$/);
    expect(token.remaining_seconds).toBeGreaterThanOrEqual(0);
    expect(token.remaining_seconds).toBeLessThanOrEqual(30);

    const gemsResponse = await request.get("/api/test-gems");
    expect(gemsResponse.status()).toBe(200);
    const gems = await gemsResponse.json();
    expect(typeof gems.time_now).toBe("number");
    expect(gems.time_class).toBe("Time");
    expect(gems.pack_unpack).toEqual([gems.time_now]);
    expect(gems.bigint).toBe("18446744073709551616");
    expect(typeof gems.rational).toBe("number");
  });
});
