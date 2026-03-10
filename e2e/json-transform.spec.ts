import { expect, test } from "@playwright/test";

test.describe("json-transform", () => {
  test("transforms json collections through UI and API", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "JSON Transform Pipeline" })).toBeVisible();

    const homeResponse = await request.get("/api");
    expect(homeResponse.status()).toBe(200);
    const home = await homeResponse.json();
    expect(home.name).toBe("JSON Transform Pipeline");
    expect(Array.isArray(home.endpoints)).toBe(true);
    expect(home.endpoints.some((endpoint: { path: string }) => endpoint.path === "/transform/pipeline")).toBe(true);

    await page.click("#btn-filter");
    await expect(page.locator("#result-output")).toContainText('"count": 3');

    await page.click("#btn-pipeline");
    await expect(page.locator("#result-output")).toContainText('"name": "banana"');
    await expect(page.locator("#gems-output")).toContainText("lazy_enumerator");

    const data = [
      { id: 1, name: "A", type: "fruit", score: 2 },
      { id: 2, name: "B", type: "vegetable", score: 5 },
      { id: 3, name: "C", type: "fruit", score: 4 },
      { id: 4, name: "A", type: "fruit", score: 1 },
    ];

    const filterResponse = await request.post("/transform/filter", {
      headers: {
        "content-type": "application/json",
      },
      data: { data, field: "type", value: "fruit" },
    });
    expect(filterResponse.status()).toBe(200);
    const filtered = await filterResponse.json();
    expect(filtered.count).toBe(3);
    expect(filtered.result.map((item: { id: number }) => item.id)).toEqual([1, 3, 4]);

    const mapResponse = await request.post("/transform/map", {
      headers: {
        "content-type": "application/json",
      },
      data: { data, fields: ["name", "score"] },
    });
    expect(mapResponse.status()).toBe(200);
    const mapped = await mapResponse.json();
    expect(mapped.result).toEqual([
      { name: "A", score: 2 },
      { name: "B", score: 5 },
      { name: "C", score: 4 },
      { name: "A", score: 1 },
    ]);

    const groupResponse = await request.post("/transform/group", {
      headers: {
        "content-type": "application/json",
      },
      data: { data, field: "type" },
    });
    expect(groupResponse.status()).toBe(200);
    const grouped = await groupResponse.json();
    expect(grouped.result.fruit).toHaveLength(3);
    expect(grouped.result.vegetable).toHaveLength(1);

    const uniqueResponse = await request.post("/transform/unique", {
      headers: {
        "content-type": "application/json",
      },
      data: { data, field: "name" },
    });
    expect(uniqueResponse.status()).toBe(200);
    const unique = await uniqueResponse.json();
    expect(unique.unique_count).toBe(3);
    expect(unique.result.map((item: { name: string }) => item.name)).toEqual(["A", "B", "C"]);

    const pipelineResponse = await request.post("/transform/pipeline", {
      headers: {
        "content-type": "application/json",
      },
      data: {
        data,
        operations: [
          { type: "filter", field: "type", value: "fruit" },
          { type: "sort", field: "score", direction: "desc" },
          { type: "limit", count: 2 },
          { type: "map", fields: ["name", "score"] },
        ],
      },
    });
    expect(pipelineResponse.status()).toBe(200);
    const piped = await pipelineResponse.json();
    expect(piped.count).toBe(2);
    expect(piped.result).toEqual([
      { name: "C", score: 4 },
      { name: "A", score: 2 },
    ]);

    const gemsResponse = await request.get("/api/test-gems");
    expect(gemsResponse.status()).toBe(200);
    const gems = await gemsResponse.json();
    expect(gems.lazy_enumerator).toEqual([8, 10, 12]);
    expect(gems.set).toEqual([1, 2, 3]);
    expect(gems.enumerator).toEqual([10, 20, 30]);
  });
});
