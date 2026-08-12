import { test, expect } from "./fixtures.js";
import { assertNoWcagViolations } from "../src/axe.js";
import { OWNER_TEST_EMAIL } from "../src/config.js";

test.describe("Login (unauthenticated)", () => {
  test("email step", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Email")).toBeVisible();
    await assertNoWcagViolations(page, "Login — email step");
  });

  test("code step and error state", async ({ page }) => {
    await page.goto("/");
    // A real account (the fixed-OTP test account) so Cognito issues a real
    // challenge and advances to the code step — a nonexistent email would
    // error before ever reaching it.
    await page.getByLabel("Email").fill(OWNER_TEST_EMAIL);
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByLabel("Code")).toBeVisible();
    await assertNoWcagViolations(page, "Login — code step");

    // Deliberately wrong code, to scan the error state too — never
    // completes sign-in, so this doesn't touch any real session.
    await page.getByLabel("Code").fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await assertNoWcagViolations(page, "Login — wrong-code error state");
  });
});
