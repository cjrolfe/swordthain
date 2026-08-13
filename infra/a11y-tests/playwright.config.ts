import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./src/config.js";

// Fail-fast posture matching infra/regression-tests' exit-non-zero-on-any-
// failure behavior — this is a CI gate, not a flaky-test-tolerant suite.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  // The Owner-session fixture signs in against one fixed-OTP account
  // shared by every test — concurrent InitiateAuth/RespondToAuthChallenge
  // calls for the same account raced and intermittently failed with
  // multiple workers, so this suite runs strictly serially.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
