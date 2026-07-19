import type { DefineAuthChallengeTriggerHandler } from "aws-lambda";

const MAX_ATTEMPTS = 3;

/**
 * Custom auth flow for passwordless email-OTP sign-in: always a single
 * CUSTOM_CHALLENGE round, retried up to MAX_ATTEMPTS times before the
 * whole sign-in attempt fails (the client must call InitiateAuth again
 * for a fresh code after that).
 */
export const handler: DefineAuthChallengeTriggerHandler = async (event) => {
  const session = event.request.session;
  const lastAttempt = session[session.length - 1];

  if (lastAttempt?.challengeName === "CUSTOM_CHALLENGE" && lastAttempt.challengeResult) {
    event.response.issueTokens = true;
    event.response.failAuthentication = false;
    return event;
  }

  if (session.length >= MAX_ATTEMPTS) {
    event.response.issueTokens = false;
    event.response.failAuthentication = true;
    return event;
  }

  event.response.issueTokens = false;
  event.response.failAuthentication = false;
  event.response.challengeName = "CUSTOM_CHALLENGE";
  return event;
};
