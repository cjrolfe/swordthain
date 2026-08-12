import { test as base } from "@playwright/test";
import { signInAsOwner, buildSyntheticMemberSession, Session } from "../src/auth.js";
import { seedSession } from "../src/session-seed.js";

export const test = base.extend<object, { ownerSession: Session; memberSession: Session }>({
  // Worker-scoped: one real Cognito sign-in per worker, not per test.
  ownerSession: [
    async ({}, use) => {
      await use(await signInAsOwner());
    },
    { scope: "worker" },
  ],
  memberSession: [
    async ({ ownerSession }, use) => {
      await use(buildSyntheticMemberSession(ownerSession));
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";
export { seedSession };
