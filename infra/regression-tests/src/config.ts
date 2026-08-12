// Same non-secret posture as apps/media-app-cli/src/config.ts — these are
// public client-side identifiers, not credentials. Overridable via env vars.
export const AWS_REGION = process.env.SWORDTHAIN_AWS_REGION ?? "us-east-1";
export const COGNITO_CLIENT_ID = process.env.SWORDTHAIN_COGNITO_CLIENT_ID ?? "71qr9fcrcspphp0n2p8htiq8ug";
export const API_URL = process.env.SWORDTHAIN_API_URL ?? "https://ox8boap6v6.execute-api.eu-west-1.amazonaws.com";

// Matches infra/lib/auth-stack.ts's regressionTestEmail/regressionTestOtpParam
// constants and infra/lib/ci-stack.ts's RegressionTestCiRole grant — all four
// must agree, which is why they're plain literals rather than something
// meant to vary per environment (this app has one, not a dev/staging split).
export const REGRESSION_TEST_EMAIL = process.env.REGRESSION_TEST_EMAIL ?? "ci-test@swordthain.com";
export const REGRESSION_TEST_OTP_PARAM = process.env.REGRESSION_TEST_OTP_PARAM ?? "/swordthain/regression-test/otp-code";

// The dedicated "CI Test" folder (infra/regression-tests/README.md documents
// how it was provisioned) — every scenario's destructive operations are
// scoped to inside this one folder and nothing else.
export const CI_TEST_FOLDER_ID = process.env.REGRESSION_TEST_FOLDER_ID ?? "29b9e0e4-6440-4efd-813d-5f4281b77bd3";

export const MEDIA_TABLE_NAME = process.env.SWORDTHAIN_MEDIA_TABLE_NAME ?? "swordthain-media-items";
