import { expect, test } from "@playwright/test";

test.describe("url-shortener", () => {
  test("shortens urls, redirects, and tracks stats", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Homura URL Shortener" })).toBeVisible();
    await expect(page.locator("#url-input")).toBeVisible();

    const shortenResponse = await request.post("/shorten", {
      headers: {
        "content-type": "application/json",
      },
      data: { url: "https://example.com" },
    });
    expect(shortenResponse.status()).toBe(201);
    const shortened = await shortenResponse.json();
    expect(shortened.original_url).toBe("https://example.com");
    expect(shortened.short_url).toMatch(/^\/s\/[0-9A-Za-z]{6}$/);
    expect(shortened.code).toMatch(/^[0-9A-Za-z]{6}$/);

    const redirectResponse = await request.get(`/s/${shortened.code}`, {
      maxRedirects: 0,
    });
    expect(redirectResponse.status()).toBe(302);
    expect(redirectResponse.headers().location).toBe("https://example.com");

    const statsResponse = await request.get(`/api/stats/${shortened.code}`);
    expect(statsResponse.status()).toBe(200);
    const stats = await statsResponse.json();
    expect(stats.code).toBe(shortened.code);
    expect(stats.original_url).toBe("https://example.com");
    expect(stats.clicks).toBe(1);

    const gemsResponse = await request.get("/api/test-gems");
    expect(gemsResponse.status()).toBe(200);
    const gems = await gemsResponse.json();
    expect(typeof gems.random).toBe("number");
    expect(typeof gems.time).toBe("number");
    expect(gems.pack).toBe("Hello");
    expect(gems.set).toBe(3);
  });
});
