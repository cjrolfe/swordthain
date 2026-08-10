import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { AWS_REGION, COGNITO_CLIENT_ID, CONFIG_DIR, SESSION_FILE } from "./config.js";

const client = new CognitoIdentityProviderClient({ region: AWS_REGION });

export interface Session {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  /** epoch ms */
  expiresAt: number;
}

/** Thrown when a submitted code is wrong — carries the next Session token to retry with. */
class WrongCodeError extends Error {
  constructor(public nextChallengeSession: string) {
    super("Incorrect or expired code");
  }
}

async function loadSession(): Promise<Session | null> {
  try {
    const raw = await readFile(SESSION_FILE, "utf8");
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

async function saveSession(session: Session): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(SESSION_FILE, JSON.stringify(session), { mode: 0o600 });
}

async function clearSession(): Promise<void> {
  await rm(SESSION_FILE, { force: true });
}

async function requestCode(email: string): Promise<string> {
  const res = await client.send(
    new InitiateAuthCommand({
      AuthFlow: "CUSTOM_AUTH",
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: { USERNAME: email },
    })
  );
  if (!res.Session) throw new Error("Cognito did not return a challenge session");
  return res.Session;
}

async function submitCode(email: string, code: string, challengeSession: string): Promise<Session> {
  const res = await client.send(
    new RespondToAuthChallengeCommand({
      ClientId: COGNITO_CLIENT_ID,
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
  await saveSession(session);
  return session;
}

async function refreshSession(refreshToken: string): Promise<Session | null> {
  try {
    const res = await client.send(
      new InitiateAuthCommand({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: COGNITO_CLIENT_ID,
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
    await saveSession(session);
    return session;
  } catch {
    await clearSession();
    return null;
  }
}

/** Interactive email + emailed-code prompt, retrying on a wrong code. */
async function promptLogin(emailArg?: string): Promise<Session> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("Sign in to Swordthain");
    const email = emailArg ?? (await rl.question("Email: "));
    let challengeSession = await requestCode(email);
    console.log(`A 6-digit code has been sent to ${email}. Check your email.`);

    for (;;) {
      const code = await rl.question("Code: ");
      try {
        const session = await submitCode(email, code, challengeSession);
        console.log(`Signed in as ${email}.`);
        return session;
      } catch (err) {
        if (err instanceof WrongCodeError) {
          console.log("That code was incorrect or has expired — try again.");
          challengeSession = err.nextChallengeSession;
          continue;
        }
        throw err;
      }
    }
  } finally {
    rl.close();
  }
}

/**
 * Returns a valid ID token for API calls, transparently refreshing if it's
 * near expiry, and running the interactive login prompt if there's no
 * usable session at all.
 */
export async function getValidIdToken(emailArg?: string): Promise<string> {
  let session = await loadSession();
  if (session && Date.now() > session.expiresAt - 60_000) {
    session = await refreshSession(session.refreshToken);
  }
  if (!session) {
    session = await promptLogin(emailArg);
  }
  return session.idToken;
}
