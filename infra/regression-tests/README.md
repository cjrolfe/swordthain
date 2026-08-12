# Swordthain Regression Tests

Automated checks against the real deployed backend — no OTP needed. Signs in as a dedicated, Owner-privileged test account (`ci-test@swordthain.com`) using a fixed code stored in SSM, then exercises real CRUD flows against `apps/media-app`'s live API, cleaning up everything it creates.

## Running it

```bash
npm install
npm test
```

Needs AWS credentials for two things: `ssm:GetParameter` on `/swordthain/regression-test/otp-code` (the fixed sign-in code), and `dynamodb:PutItem`/`DeleteItem` on `swordthain-media-items` (the `playlists` scenario's synthetic video fixture — see `src/db.ts`). Everything else is a plain HTTPS call, same as any real client. Locally, ambient credentials with broader access work fine. In CI, `swordthain-regression-test-ci` (`infra/lib/ci-stack.ts`) is scoped to exactly those two things and nothing else.

The DynamoDB grant wasn't there on the first real CI run — it worked locally (ambient AWS CLI credentials have broader access than the CI role, which masked the gap) but failed in CI with an honest `AccessDeniedException` on the very first attempt. Left here as a reminder that "works on my machine" isn't proof for anything touching IAM — the real CI role is the only trustworthy check.

Run a subset while iterating on one area:

```bash
npm test -- --only=folders,media
```

## What it covers

- **`smoke`** — sign-in works and the CI Test folder is reachable. Fast canary.
- **`folders`** — create/rename/move/delete, including the two Move guard rails (400 on self-move, 409 on move-into-own-descendant).
- **`media`** — real photo upload → waits for `ThumbnailFn` to actually process it → set/clear description → delete, confirming against the real pipeline, not just the API's immediate response.
- **`playlists`** — create → add item → list → remove → delete. Uses a directly-inserted synthetic `MediaItems` row rather than a real video upload — see the comment in `src/db.ts` for why (no locally-generated test video has been found that the deployed, 2018-vintage static ffmpeg layer can read; real video upload/thumbnailing is exercised whenever a real video goes through the app normally).

**Not covered yet**: `apps/playground`/`labs.swordthain.com`, and anything that only a real browser would catch (e.g. a CSP misconfiguration) — both noted as deliberate v1 exclusions, not oversights.

## Everything happens inside one folder

All destructive operations are scoped to the "CI Test" folder (`29b9e0e4-6440-4efd-813d-5f4281b77bd3`, `src/config.ts`'s `CI_TEST_FOLDER_ID`). Nothing outside it is ever touched. Each scenario cleans up what it created in a `finally` block, so a failed run shouldn't leave stray data behind.

## Adding a new scenario

Whenever a feature ships or changes, add or extend a file in `src/scenarios/` — an async `run(api)` function that creates what it needs, asserts on the results (`src/assert.ts`), and cleans up in a `finally`. Register it in `src/run.ts`'s `SCENARIOS` map.

## How the fixed-OTP sign-in works

`infra/lambda/auth/create-auth-challenge.ts` has a narrow special case: for exactly one pre-configured email (`REGRESSION_TEST_EMAIL`), it uses a fixed code from SSM instead of a random one, and skips sending it by email entirely (nothing would be monitoring that inbox). Every other account's real random-OTP flow is completely unchanged — `infra/lambda/auth/verify-auth-challenge-response.ts` needed zero changes, since it just compares a submitted code's hash against whatever hash was stored, generically, regardless of whether the code behind it was random or fixed.

`src/auth.ts` mirrors `apps/media-app-cli/src/auth.ts`'s `InitiateAuth`/`RespondToAuthChallenge` calls almost exactly, minus the interactive prompt — the code is already known (read from SSM), so it signs in in one shot.
