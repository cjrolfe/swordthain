import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { AWS_REGION, COGNITO_CLIENT_ID, OWNER_TEST_EMAIL, OWNER_TEST_OTP_PARAM } from "./config.js";

const cognito = new CognitoIdentityProviderClient({ region: AWS_REGION });
const ssm = new SSMClient({ region: AWS_REGION });

/** Matches apps/media-app/src/auth.ts's Session interface exactly — this is what gets seeded into localStorage. */
export interface Session {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

let cachedTestOtp: string | undefined;

async function getTestOtp(): Promise<string> {
  if (cachedTestOtp) return cachedTestOtp;
  const result = await ssm.send(new GetParameterCommand({ Name: OWNER_TEST_OTP_PARAM, WithDecryption: true }));
  const value = result.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${OWNER_TEST_OTP_PARAM} has no value`);
  cachedTestOtp = value;
  return value;
}

/**
 * Signs in as the Owner-privileged fixed-OTP test account (same one
 * infra/regression-tests uses) and returns a full Session — unlike that
 * package's own auth.ts, which only keeps the idToken, this needs
 * accessToken/refreshToken/expiresAt too since the whole point is to seed
 * apps/media-app's real localStorage shape (apps/media-app/src/auth.ts's
 * Session interface) via Playwright's addInitScript, skipping the live OTP
 * UI flow entirely.
 */
export async function signInAsOwner(): Promise<Session> {
  const code = await getTestOtp();

  const initRes = await cognito.send(
    new InitiateAuthCommand({
      AuthFlow: "CUSTOM_AUTH",
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: { USERNAME: OWNER_TEST_EMAIL },
    })
  );
  if (!initRes.Session) throw new Error("Cognito did not return a challenge session");

  const respRes = await cognito.send(
    new RespondToAuthChallengeCommand({
      ClientId: COGNITO_CLIENT_ID,
      ChallengeName: "CUSTOM_CHALLENGE",
      Session: initRes.Session,
      ChallengeResponses: { USERNAME: OWNER_TEST_EMAIL, ANSWER: code },
    })
  );

  const { AccessToken, IdToken, RefreshToken, ExpiresIn } = respRes.AuthenticationResult ?? {};
  if (!AccessToken || !IdToken || !RefreshToken) {
    throw new Error(
      "Sign-in failed — no tokens returned. Check that the fixed OTP in SSM matches " +
        "what create-auth-challenge.ts is issuing."
    );
  }

  return {
    accessToken: AccessToken,
    idToken: IdToken,
    refreshToken: RefreshToken,
    expiresAt: Date.now() + (ExpiresIn ?? 3600) * 1000,
  };
}

/**
 * A synthetic (unsigned, not cryptographically valid) Member-role session,
 * built from a real Owner session by swapping the ID token's payload for
 * one with no Owner group claim. apps/media-app's frontend never verifies
 * the JWT signature client-side — it only decodes the payload
 * (apps/media-app/src/auth.ts's decodeJwtPayload/isOwner) — so this is
 * sufficient to render the Member view's DOM/markup for a11y scanning.
 * It does NOT carry real API access: any component that fetches live data
 * (e.g. FolderBrowser's folder list) will hit an error/empty state rather
 * than showing real content, since the real API's JWT authorizer DOES
 * verify the signature and will reject this token. That's an accepted
 * trade-off — the goal here is markup/ARIA coverage of the Member-only
 * rendering branches, not exercising real data for the second time (the
 * Owner-session tests already do that for the shared component tree).
 */
export function buildSyntheticMemberSession(ownerSession: Session): Session {
  const [header] = ownerSession.idToken.split(".");
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: "a11y-synthetic-member",
      email: "a11y-synthetic-member@swordthain.com",
      "cognito:groups": [],
      exp: Math.floor(ownerSession.expiresAt / 1000),
    })
  );
  return {
    ...ownerSession,
    idToken: `${header}.${payload}.`,
  };
}

function base64UrlEncode(json: string): string {
  return Buffer.from(json, "utf8").toString("base64url");
}
