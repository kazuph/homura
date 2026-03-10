import { expect, test } from "@playwright/test";

test.describe("template-engine", () => {
  test("lists templates and renders escaped html safely", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Micro Template Engine Studio" })).toBeVisible();

    const homeResponse = await request.get("/api");
    expect(homeResponse.status()).toBe(200);
    const home = await homeResponse.json();
    expect(home.name).toBe("Micro Template Engine");
    expect(home.features).toContain("HTML escaping");

    await page.click("#btn-inline");
    await expect(page.locator("#status-pill")).toContainText("Rendered");
    await expect(page.locator("#response-output")).toContainText("&lt;script&gt;");

    const srcdoc = await page.locator("#preview-frame").evaluate((iframe: HTMLIFrameElement) => iframe.srcdoc || "");
    expect(srcdoc).toContain("Inline Template");
    expect(srcdoc).toContain("&lt;script&gt;");

    const templatesResponse = await request.get("/templates");
    expect(templatesResponse.status()).toBe(200);
    const templates = await templatesResponse.json();
    expect(templates.templates).toEqual(["page", "list"]);

    const renderResponse = await request.post("/render", {
      headers: {
        "content-type": "application/json",
      },
      data: {
        template: "page",
        data: {
          title: "Hello",
          body: "<strong>World</strong>",
        },
      },
    });
    expect(renderResponse.status()).toBe(200);
    const renderedPage = await renderResponse.text();
    expect(renderedPage).toContain("<title>Hello</title>");
    expect(renderedPage).toContain("&lt;strong&gt;World&lt;/strong&gt;");
    expect(renderedPage).not.toContain("<strong>World</strong>");

    const inlineResponse = await request.post("/render/inline", {
      headers: {
        "content-type": "application/json",
      },
      data: {
        template: "Hello {{name}}",
        data: {
          name: "World",
        },
      },
    });
    expect(inlineResponse.status()).toBe(200);
    expect(await inlineResponse.text()).toBe("Hello World");

    const gemsResponse = await request.get("/api/test-gems");
    expect(gemsResponse.status()).toBe(200);
    const gems = await gemsResponse.json();
    expect(gems.html_escape).toBe("<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>");
    expect(gems.templates).toEqual(["page", "list"]);
    expect(typeof gems.generated_at).toBe("number");
  });
});
