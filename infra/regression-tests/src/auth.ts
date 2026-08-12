import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { AWS_REGION, COGNITO_CLIENT_ID, REGRESSION_TEST_EMAIL, REGRESSION_TEST_OTP_PARAM } from "./config.js";

const cognito = new CognitoIdentityProviderClient({ region: AWS_REGION });
const ssm = new SSMClient({ region: AWS_REGION });

/**
 * Signs in as the dedicated regression-test account with zero human
 * interaction: the OTP is a fixed value (infra/lambda/auth/create-auth-challenge.ts's
 * isTestAccount branch stores this same value's hash instead of a random
 * code's), read from the same SSM parameter that Lambda reads server-side.
 * Every other account still goes through the real random-code flow this
 * mirrors — apps/media-app-cli/src/auth.ts's requestCode/submitCode, minus
 * the interactive prompt since the code is already known.
 */
export async function signIn(): Promise<string> {
  const code = await getTestOtp();

  const initRes = await cognito.send(
    new InitiateAuthCommand({
      AuthFlow: "CUSTOM_AUTH",
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: { USERNAME: REGRESSION_TEST_EMAIL },
    })
  );
  if (!initRes.Session) throw new Error("Cognito did not return a challenge session");

  const respRes = await cognito.send(
    new RespondToAuthChallengeCommand({
      ClientId: COGNITO_CLIENT_ID,
      ChallengeName: "CUSTOM_CHALLENGE",
      Session: initRes.Session,
      ChallengeResponses: { USERNAME: REGRESSION_TEST_EMAIL, ANSWER: code },
    })
  );

  const idToken = respRes.AuthenticationResult?.IdToken;
  if (!idToken) {
    throw new Error(
      "Sign-in failed — no tokens returned. Check that the fixed OTP in SSM matches " +
        "what create-auth-challenge.ts is issuing, and that the deployed Lambda has " +
        "REGRESSION_TEST_EMAIL/REGRESSION_TEST_OTP_PARAM set."
    );
  }
  return idToken;
}

async function getTestOtp(): Promise<string> {
  const result = await ssm.send(new GetParameterCommand({ Name: REGRESSION_TEST_OTP_PARAM, WithDecryption: true }));
  const value = result.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${REGRESSION_TEST_OTP_PARAM} has no value`);
  return value;
}
