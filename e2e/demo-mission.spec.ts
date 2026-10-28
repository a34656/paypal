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

test("blocked mission → recovery guidance → confirmed revision is re-evaluated (original untouched)", async ({ page }) => {
  // The scenario link opens the free-text tab; replace its text with a budget the catalogue cannot meet.
  await page.goto("/missions/new?scenario=usb-cables");
  await page.getByLabel("Describe the purchasing mission").fill("Buy 50 USB-C cables, 1m, 60W, for the hardware bench. Budget $100, needed within 10 days.");
  await page.getByRole("button", { name: "Parse mission" }).click();
  await page.getByRole("button", { name: "Confirm constraints" }).click();
  await page.getByTestId("execute-mission").click();

  const panel = page.getByTestId("recovery-panel");
  await expect(panel.getByRole("heading", { name: "Let's make this purchase work" })).toBeVisible({ timeout: 30_000 });
  // Lowest identified total is the unbranded offer's spending cap (50 × $2.10 + 15% allowance).
  await expect(panel.getByText("$120.75 − $100.00 = $20.75")).toBeVisible();
  await expect(panel.getByTestId("next-action").getByText("Quantity 50 → 9 (41 fewer), budget unchanged.")).toBeVisible();

  // Every failed check, with actual vs permitted values.
  await panel.getByTestId("explain-checks").click();
  await expect(panel.getByTestId("failed-checks").getByText("Budget only").first()).toBeVisible();

  // Alternatives come from the demo catalogue and are labelled as such.
  await panel.getByTestId("find-alternatives").click();
  await panel.getByRole("button", { name: "Search the provider" }).click();
  await expect(panel.getByTestId("alternatives").getByText("Demo data").first()).toBeVisible();

  // Apply the suggested budget: old → new is shown, nothing happens until explicitly confirmed.
  const originalUrl = page.url();
  await panel.getByTestId("apply-budget").click();
  const editor = panel.getByTestId("revision-editor");
  await expect(editor.getByText("$100.00", { exact: true })).toBeVisible();
  await expect(editor.getByTestId("submit-revision")).toBeDisabled();
  await editor.getByTestId("confirm-revision").check();
  await editor.getByTestId("submit-revision").click();

  await expect(page).not.toHaveURL(originalUrl, { timeout: 30_000 });
  await expect(page.getByTestId("revision-lineage").getByText(/Revision 1 of/)).toBeVisible({ timeout: 30_000 });
  // The revision passed policy but still needs a human before any order.
  await expect(page.getByText("Owner authorisation required")).toBeVisible({ timeout: 30_000 });

  await page.goto(originalUrl);
  await expect(page.getByTestId("revision-lineage").getByText("Revision 1")).toBeVisible();
  await expect(page.getByTestId("recovery-panel")).toBeVisible();
});
