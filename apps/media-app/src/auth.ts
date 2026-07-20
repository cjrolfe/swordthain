import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({ region: import.meta.env.VITE_AWS_REGION });
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;

const STORAGE_KEY = "swordthain_session";
// Shared with apps/playground and the labs.swordthain.com CloudFront
// Function's stealth gate — must stay in sync with that name.
const SESSION_COOKIE_NAME = "swordthain_session";

export interface Session {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  /** epoch ms */
  expiresAt: number;
}

/** Thrown when a submitted code is wrong — carries the next Session token to retry with. */
export class WrongCodeError extends Error {
  constructor(public nextChallengeSession: string) {
    super("Incorrect or expired code");
  }
}

export function loadSession(): Session | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

function saveSession(session: Session): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  setSessionCookie(session);
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
  clearSessionCookie();
}

/**
 * A copy of the ID token as a cookie on the parent domain, so
 * labs.swordthain.com's edge-level stealth check (a CloudFront Function —
 * see infra/lib/playground-stack.ts) can see it. Deliberately not
 * HttpOnly: it's set from client-side JS after a browser-based login,
 * which can't mark a cookie HttpOnly anyway, and this cookie was never
 * the real security boundary — it just mirrors what's already sitting in
 * localStorage. Real authorization stays with the Cognito-verified JWT
 * on every actual API call.
 */
function setSessionCookie(session: Session): void {
  if (!window.location.hostname.endsWith("swordthain.com")) return; // local dev — no cross-subdomain need
  const maxAge = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
  document.cookie = `${SESSION_COOKIE_NAME}=${session.idToken}; domain=.swordthain.com; path=/; max-age=${maxAge}; secure; samesite=lax`;
}

function clearSessionCookie(): void {
  if (!window.location.hostname.endsWith("swordthain.com")) return;
  document.cookie = `${SESSION_COOKIE_NAME}=; domain=.swordthain.com; path=/; max-age=0; secure; samesite=lax`;
}

/** Step 1: request a 6-digit code be emailed. Returns the Cognito challenge session token. */
export async function requestCode(email: string): Promise<string> {
  const res = await client.send(
    new InitiateAuthCommand({
      AuthFlow: "CUSTOM_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: email },
    })
  );
  if (!res.Session) throw new Error("Cognito did not return a challenge session");
  return res.Session;
}

/** Step 2: submit the code. Throws WrongCodeError (with a session to retry) if incorrect. */
export async function submitCode(email: string, code: string, challengeSession: string): Promise<Session> {
  const res = await client.send(
    new RespondToAuthChallengeCommand({
      ClientId: CLIENT_ID,
      ChallengeName: "CUSTOM_CHALLENGE",
      Session: challengeSession,
      ChallengeResponses: { USERNAME: email, ANSWER: code },
    })
  );

  if (!res.AuthenticationResult) {
    if (!res.Session) throw new Error("Sign-in failed — please request a new code");
    throw new WrongCodeError(res.Session);
  }

  const { AccessToken, IdToken, RefreshToken, ExpiresIn } = res.AuthenticationResult;
  if (!AccessToken || !IdToken || !RefreshToken) throw new Error("Incomplete authentication result from Cognito");

  const session: Session = {
    accessToken: AccessToken,
    idToken: IdToken,
    refreshToken: RefreshToken,
    expiresAt: Date.now() + (ExpiresIn ?? 3600) * 1000,
  };
  saveSession(session);
  return session;
}

async function refreshSession(refreshToken: string): Promise<Session | null> {
  try {
    const res = await client.send(
      new InitiateAuthCommand({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: CLIENT_ID,
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      })
    );
    const { AccessToken, IdToken, ExpiresIn } = res.AuthenticationResult ?? {};
    if (!AccessToken || !IdToken) return null;

    const session: Session = {
      accessToken: AccessToken,
      idToken: IdToken,
      refreshToken,
      expiresAt: Date.now() + (ExpiresIn ?? 3600) * 1000,
    };
    saveSession(session);
    return session;
  } catch {
    clearSession();
    return null;
  }
}

/** Returns a valid ID token for API calls, transparently refreshing if it's near expiry. */
export async function getValidIdToken(): Promise<string | null> {
  let session = loadSession();
  if (!session) return null;
  if (Date.now() > session.expiresAt - 60_000) {
    session = await refreshSession(session.refreshToken);
    if (!session) return null;
  }
  return session.idToken;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
}

export function isOwner(session: Session): boolean {
  const claims = decodeJwtPayload(session.idToken);
  const groups = claims["cognito:groups"];
  return Array.isArray(groups) && groups.includes("Owner");
}
