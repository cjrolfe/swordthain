import { homedir } from "node:os";
import { join } from "node:path";

// Same non-secret posture as apps/media-app's committed .env — these are
// public client-side identifiers (Cognito app client has no secret), not
// credentials. Overridable via env vars for future flexibility/testing.
export const AWS_REGION = process.env.SWORDTHAIN_AWS_REGION ?? "us-east-1";
export const COGNITO_CLIENT_ID = process.env.SWORDTHAIN_COGNITO_CLIENT_ID ?? "71qr9fcrcspphp0n2p8htiq8ug";
export const API_URL = process.env.SWORDTHAIN_API_URL ?? "https://ox8boap6v6.execute-api.eu-west-1.amazonaws.com";

export const CONFIG_DIR = join(homedir(), ".swordthain-cli");
export const SESSION_FILE = join(CONFIG_DIR, "session.json");
export const MULTIPART_STATE_DIR = join(CONFIG_DIR, "multipart-state");
