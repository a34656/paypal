import { expect, test, type Page, type Request } from "@playwright/test";

async function launch(page: Page, scenario: "robotics-lab" | "gpu-servers" | "usb-cables") {
  await page.goto(`/missions/new?scenario=${scenario}`);
  await page.getByRole("button", { name: "Parse mission" }).click();
  await expect(page.getByRole("heading", { name: "Confirm mission constraints" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm constraints" }).click();
  await page.getByTestId("execute-mission").click();
  await expect(page.getByRole("heading", { name: "Recommendations & risk" })).toBeVisible({ timeout: 30_000 });
}

test("landing → demo mission → risk → approve → simulated checkout → transactions → read-only replay", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /INTELLIGENCE IN MOTION/ })).toBeVisible();
  await page.getByRole("link", { name: "Run a demo mission" }).click();
  await expect(page.getByLabel("Describe the purchasing mission")).toHaveValue(/Raspberry Pi/);

  await page.getByRole("button", { name: "Parse mission" }).click();
  // Parsed constraints are a proposal shown for confirmation.
  await expect(page.getByLabel("Quantity")).toHaveValue("20");
  await expect(page.getByLabel("Total budget (USD)")).toHaveValue("2500.00");
  await page.getByRole("button", { name: "Confirm constraints" }).click();
  await page.getByTestId("execute-mission").click();

  // Recommendation and risk.
  const offers = page.getByRole("table", { name: /Candidate offers/ });
  await expect(offers).toBeVisible({ timeout: 30_000 });
  await expect(offers.getByRole("row", { name: /Northwind Robotics/ }).getByText("#1")).toBeVisible();
  // Prompt-injection listing is blocked, and over-budget kit is blocked.
  await expect(offers.getByRole("row", { name: /SYSTEM NOTICE/ }).getByText("Block")).toBeVisible();
  await expect(offers.getByRole("row", { name: /industrial kit/ }).getByText("Block")).toBeVisible();
  await expect(page.getByText("Approver sign-off required")).toBeVisible();

  // Human approval of the exact purchase.
  await page.getByRole("checkbox", { name: /I reviewed this exact purchase/ }).check();
  await page.getByRole("button", { name: "Approve this purchase" }).click();
  await expect(page.getByText("Simulated checkout (DEMO MODE — PayPal not connected)")).toBeVisible();

  // Capture is refused before (simulated) buyer approval; then runs both gates.
  await page.getByRole("button", { name: "Create simulated order" }).click();
  await expect(page.getByRole("button", { name: "Simulate buyer approval" })).toBeEnabled();
  await page.getByRole("button", { name: "Simulate buyer approval" }).click();
  await page.getByRole("button", { name: "Capture (simulated)" }).click();
  await expect(page.getByText("SIMULATED — no money moved. This is not a PayPal payment.")).toBeVisible();
  // Demo mode never claims a genuine PayPal payment.
  await expect(page.getByText(/Capture confirmed by PayPal/)).toHaveCount(0);
  await expect(page.getByText(/DEMO MODE — PAYPAL NOT CONNECTED/)).toBeVisible();
  const missionUrl = page.url();

  // Transactions grid labels the row as simulated.
  await page.getByRole("link", { name: "Transactions" }).click();
  await expect(page.getByRole("gridcell", { name: /Purchase 20 Raspberry Pi/ })).toBeVisible();
  await expect(page.getByRole("gridcell").filter({ hasText: "Demo · simulated" }).first()).toBeVisible();

  // Replay performs zero write requests and no provider calls.
  await page.goto(missionUrl);
  const writes: Request[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" || /paypal\.com/.test(r.url())) writes.push(r);
  });
  await page.getByTestId("tab-replay").click();
  await page.getByTestId("replay-play").click();
  await page.waitForTimeout(2500);
  await page.getByTestId("replay-scrubber").fill("17");
  await expect(page.getByTestId("replay-panel").getByText(/Captured|Mission completed/).first()).toBeVisible();
  await page.getByTestId("replay-scrubber").fill("0");
  await page.waitForTimeout(500);
  expect(writes.map((w) => `${w.method()} ${w.url()}`)).toEqual([]);
});

test("policy block: mission budget above the policy cap cannot be approved", async ({ page }) => {
  await launch(page, "gpu-servers");
  await expect(page.getByText("Every candidate was blocked or ineligible.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve|Authorise/ })).toHaveCount(0);
  await expect(page.getByText("blocked").first()).toBeVisible();
});

test("allow-checkout still requires an explicit owner authorisation", async ({ page }) => {
  await launch(page, "usb-cables");
  await expect(page.getByText("Owner authorisation required")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create simulated order" })).toHaveCount(0);
});

test("audit chain verifies", async ({ page }) => {
  await page.goto("/audit");
  await expect(page.getByText(/Hash chain verified/)).toBeVisible();
});

test("PayPal Sandbox checkout (only when credentials are configured)", async () => {
  test.skip(true, "Unverified here: no PayPal Sandbox credentials in this environment. E2E forces demo mode and never contacts PayPal.");
});
