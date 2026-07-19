import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({ region: import.meta.env.VITE_AWS_REGION });
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;

const STORAGE_KEY = "swordthain_session";

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
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
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
