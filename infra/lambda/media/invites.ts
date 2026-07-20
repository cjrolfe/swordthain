import type { APIGatewayProxyHandlerV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  UsernameExistsException,
} from "@aws-sdk/client-cognito-identity-provider";
import { isOwner } from "./authz";
import { jsonResponse } from "./http";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
// This Lambda runs in eu-west-1 (see infra/README.md's "Region split"),
// but the shared Cognito pool and SES identity both stay in us-east-1 —
// these SDK clients would otherwise default to this Lambda's own runtime region.
const cognito = new CognitoIdentityProviderClient({ region: "us-east-1" });
const ses = new SESv2Client({ region: "us-east-1" });

const FOLDERS_TABLE_NAME = process.env.FOLDERS_TABLE_NAME!;
const FOLDER_SHARES_TABLE_NAME = process.env.FOLDER_SHARES_TABLE_NAME!;
const USER_POOL_ID = process.env.USER_POOL_ID!;
const SES_FROM_ADDRESS = process.env.SES_FROM_ADDRESS!;
const SITE_URL = process.env.SITE_URL!;

const VALID_PERMISSIONS = new Set(["view", "download", "upload"]);

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  if (!isOwner(event.requestContext.authorizer.jwt.claims)) {
    return jsonResponse(403, { error: "Owner access required" });
  }

  let payload: { email?: string; folderId?: string; permission?: string; message?: string };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { email, folderId, permission, message } = payload;
  if (!email) {
    return jsonResponse(400, { error: "email is required" });
  }
  if (folderId) {
    if (!permission || !VALID_PERMISSIONS.has(permission)) {
      return jsonResponse(400, {
        error: `permission is required when folderId is set, and must be one of: ${[...VALID_PERMISSIONS].join(", ")}`,
      });
    }
    const folder = await ddb.send(new GetCommand({ TableName: FOLDERS_TABLE_NAME, Key: { folderId } }));
    if (!folder.Item) return jsonResponse(400, { error: `folderId ${folderId} does not exist` });
  }

  let sub: string;
  try {
    const created = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
        ],
        // The app's only sign-in path is passwordless email-OTP — suppress
        // Cognito's own invite email in favor of the custom one below.
        MessageAction: "SUPPRESS",
        DesiredDeliveryMediums: [],
      })
    );
    const foundSub = created.User?.Attributes?.find((a) => a.Name === "sub")?.Value;
    if (!foundSub) throw new Error("AdminCreateUser response missing sub attribute");
    sub = foundSub;
  } catch (err) {
    if (err instanceof UsernameExistsException) {
      return jsonResponse(409, { error: `${email} has already been invited` });
    }
    throw err;
  }

  await cognito.send(
    new AdminAddUserToGroupCommand({ UserPoolId: USER_POOL_ID, Username: email, GroupName: "Member" })
  );

  if (folderId) {
    await ddb.send(
      new PutCommand({
        TableName: FOLDER_SHARES_TABLE_NAME,
        Item: { folderId, userId: sub, email, permission, grantedAt: new Date().toISOString() },
      })
    );
  }

  await sendInviteEmail(email, message);

  return jsonResponse(201, { userId: sub, email, folderId: folderId ?? null, permission: permission ?? null });
};

async function sendInviteEmail(email: string, personalMessage: string | undefined): Promise<void> {
  const personalParagraph = personalMessage ? `\n${personalMessage}\n` : "";
  const text =
    `You've been invited to Swordthain, a private photo and video site.\n` +
    personalParagraph +
    `\nGetting started:\n` +
    `1. Go to ${SITE_URL}\n` +
    `2. Enter your email address (${email})\n` +
    `3. Check your email for a 6-digit code and type it in — no password to create or remember\n` +
    `4. You're in — your device stays signed in after that\n\n` +
    `If your TV has a web browser, you can open ${SITE_URL} on it directly to watch there too.`;

  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: SES_FROM_ADDRESS,
      Destination: { ToAddresses: [email] },
      Content: {
        Simple: {
          Subject: { Data: "You're invited to Swordthain" },
          Body: { Text: { Data: text } },
        },
      },
    })
  );
}
