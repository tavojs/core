import { expect, test } from "@playwright/test";

const monitorToken = process.env.TAVO_MONITOR_TOKEN || "tavo-e2e-monitor-token-2026";
const monitorHeaders = { Authorization: `Bearer ${monitorToken}` };

test.beforeEach(async ({ request }) => {
  const response = await request.get("/_tavo/monitor", { headers: monitorHeaders });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.server?.mode).toBe("production-ssr");
});

test("ssr preview renders routes, metadata, and optimized images", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();

  await page.goto("/stats");
  await expect(page.getByRole("heading", { name: "Stats Route" })).toBeVisible();

  await page.goto("/image");
  await expect(page.getByRole("heading", { name: "SEO Asset Components" })).toBeVisible();

  const image = page.getByRole("img", {
    name: "Stylized Tavo.js mountain landscape illustration"
  });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", /\/_tavo\/image\?/);
  await expect(image).toHaveAttribute("srcset", /_tavo\/image/);

  await page.goto("/manifest");
  await expect(page.getByRole("heading", { name: "Route Manifest Preview" })).toBeVisible();
});

test("static ssr page reuses cached html within the revalidate window", async ({ page, request }) => {
  const firstResponse = await request.get("/static");
  expect(firstResponse.ok()).toBeTruthy();
  const firstHtml = await firstResponse.text();

  const secondResponse = await request.get("/static");
  expect(secondResponse.ok()).toBeTruthy();
  const secondHtml = await secondResponse.text();

  expect(secondHtml).toBe(firstHtml);

  await page.goto("/static");
  await expect(page.getByRole("heading", { name: "Static SSR With Revalidate" })).toBeVisible();
});

test("production html reports SSR and CSR route modes", async ({ page, request }) => {
  const csrResponse = await request.get("/csr-only");
  expect(csrResponse.ok()).toBeTruthy();
  const csrHtml = await csrResponse.text();

  expect(csrHtml).toContain('data-tavo-render-mode="csr"');
  expect(csrHtml).toContain("<title>tavo preview - CSR only</title>");
  expect(csrHtml).not.toContain("__TAVO_STATE__");
  expect(csrHtml).not.toContain("CSR Only Page");

  await page.goto("/csr-only");
  await expect(page.getByRole("heading", { name: "CSR Only Page" })).toBeVisible();
  await expect(page.getByText(/Client render timestamp:/)).toBeVisible();

  const staticResponse = await request.get("/static");
  expect(staticResponse.ok()).toBeTruthy();
  const staticHtml = await staticResponse.text();

  expect(staticHtml).toContain('data-tavo-render-mode="ssr"');
  expect(staticHtml).toContain("__TAVO_STATE__");
  expect(staticHtml).toContain("Static SSR With Revalidate");
});

test("production server hardens static assets and survives malformed paths", async ({ request }) => {
  const assetResponse = await request.get("/site.webmanifest");
  expect(assetResponse.ok()).toBeTruthy();
  expect(assetResponse.headers()["x-content-type-options"]).toBe("nosniff");
  expect(assetResponse.headers()["x-frame-options"]).toBe("SAMEORIGIN");

  const traversalResponse = await request.get("/../package.json");
  expect(traversalResponse.status()).toBe(404);

  const malformedResponse = await request.get("/%E0%A4%A");
  expect([200, 404, 500]).toContain(malformedResponse.status());

  const followupResponse = await request.get("/stats");
  expect(followupResponse.ok()).toBeTruthy();
  expect(await followupResponse.text()).toContain("Stats Route");
});

test("production monitor requires a bearer token and emits hardening headers", async ({ request }) => {
  const unauthorized = await request.get("/_tavo/monitor");
  expect(unauthorized.status()).toBe(404);

  const response = await request.get("/_tavo/monitor", { headers: monitorHeaders });

  expect(response.ok()).toBeTruthy();
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("SAMEORIGIN");

  const payload = await response.json();
  expect(payload.server.mode).toBe("production-ssr");
  expect(payload.server.host).toBe("127.0.0.1");
});

test("streaming route resolves deferred content without stale fallbacks", async ({ page, request }) => {
  const response = await request.get("/streaming");
  expect(response.ok()).toBeTruthy();
  const html = await response.text();

  expect(html).toContain('data-tavo-render-mode="ssr"');
  expect(html).toContain("Progressive SSR Streaming");
  expect(html).toContain("Deferred chunk resolved");
  expect(html).toContain("Shared block A");
  expect(html).toContain("Shared block B");
  expect(html).toContain("Timeout fallback");

  await page.goto("/streaming");
  await expect(page.getByRole("heading", { name: "Progressive SSR Streaming" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deferred chunk resolved" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shared block A" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shared block B" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeout fallback" })).toBeVisible();
  await expect(page.getByText("Waiting for shared deferred content...")).toHaveCount(0);
  await expect(page.getByText("Waiting for a deliberately slow deferred block...")).toHaveCount(0);
});

test("client navigation keeps active nav and route state in sync", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: /About/ }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
  await expect(page.getByRole("link", { name: /About/ })).toHaveClass(/tavo-nav-link--active/);

  await page.getByRole("link", { name: /Stats/ }).click();
  await expect(page).toHaveURL(/\/stats$/);
  await expect(page.getByRole("heading", { name: "Stats Route" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Stats/ })).toHaveClass(/tavo-nav-link--active/);
});

test("global store survives client navigation and MVC store page updates", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Increment" }).click();
  await expect(page.getByText(/counter = 1/)).toBeVisible();

  await page.getByRole("link", { name: /Store/ }).click();
  await expect(page.getByRole("heading", { name: "Store API Playground" })).toBeVisible();

  await page.getByRole("button", { name: "patch count" }).click();
  await expect(page.getByText("count: 1", { exact: true })).toBeVisible();
  await expect(page.getByText(/selector events:/)).toBeVisible();

  await page.getByRole("link", { name: /Home/ }).click();
  await expect(page.getByText(/counter = 1/)).toBeVisible();
});

test("middleware redirects and nested router tabs work in the browser", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Go secure page" }).click();
  await expect(page).toHaveURL(/\/redirected$/);
  await expect(page.getByRole("heading", { name: "Middleware Redirect Example" })).toBeVisible();

  await page.getByRole("link", { name: /Home/ }).click();
  await page.getByRole("button", { name: "Toggle auth" }).click();
  await page.getByRole("button", { name: "Go secure page" }).click();
  await expect(page).toHaveURL(/\/secure$/);
  await expect(page.getByRole("heading", { name: "Secure Route" })).toBeVisible();

  await page.goto("/router/alpha");
  await expect(page.getByRole("heading", { name: "Standalone Router Interop" })).toBeVisible();
  await expect(page.getByText("SSR-safe auto-page param:")).toBeVisible();
  await expect(page.getByRole("article").getByText("alpha", { exact: true })).toBeVisible();
});

test("keyboard workflow preserves focus, actions, store state, history, and error recovery", async ({ page }) => {
  await page.goto("/");

  const storeLink = page.getByRole("link", { name: /Store/ }).first();
  await expect(storeLink).toBeVisible();
  await storeLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/store$/);
  await expect(page.locator("#tavo-route-content")).toHaveAttribute("tabindex", "-1");
  await expect(storeLink).toHaveClass(/tavo-nav-link--active/);

  await page.getByRole("button", { name: "patch count" }).click();
  await expect(page.getByText("count: 1", { exact: true })).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await page.goto("/store");
  await expect(page.getByRole("heading", { name: "Store API Playground" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/\/store$/);
  await expect(page.getByRole("heading", { name: "Store API Playground" })).toBeVisible();

  await page.goto("/auth");
  await page.evaluate(() => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/auth";
    const intent = document.createElement("input");
    intent.name = "intent";
    intent.value = "login";
    form.append(intent);
    document.body.append(form);
    form.submit();
  });
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/secure");
  await expect(page.getByRole("heading", { name: "Secure Route" })).toBeVisible();

  await page.goto("/load-error");
  await expect(page.getByRole("heading", { name: "Load Error Route" })).toBeVisible();
  await page.getByRole("link", { name: /Home/ }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
});
