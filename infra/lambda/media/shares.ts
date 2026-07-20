import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyHandlerV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  ListUsersInGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { isOwner } from "./authz";
import { jsonResponse } from "./http";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
// This Lambda runs in eu-west-1 (see infra/README.md's "Region split"),
// but the shared Cognito pool stays in us-east-1 — the SDK client would
// otherwise default to this Lambda's own runtime region.
const cognito = new CognitoIdentityProviderClient({ region: "us-east-1" });

const FOLDERS_TABLE_NAME = process.env.FOLDERS_TABLE_NAME!;
const FOLDER_SHARES_TABLE_NAME = process.env.FOLDER_SHARES_TABLE_NAME!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

const VALID_PERMISSIONS = new Set(["view", "download", "upload"]);

async function subForEmail(email: string): Promise<string | null> {
  try {
    const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: email }));
    return user.UserAttributes?.find((a) => a.Name === "sub")?.Value ?? null;
  } catch {
    return null;
  }
}

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  if (!isOwner(event.requestContext.authorizer.jwt.claims)) {
    return jsonResponse(403, { error: "Owner access required" });
  }

  switch (event.routeKey) {
    case "POST /folders/{folderId}/shares":
      return updateShare(event);
    case "GET /admin/permissions-matrix":
      return getPermissionsMatrix();
    default:
      return jsonResponse(404, { error: "Not found" });
  }
};

async function updateShare(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  const folderId = event.pathParameters?.folderId;
  if (!folderId) return jsonResponse(400, { error: "folderId is required" });

  let payload: { action?: string; email?: string; permission?: string };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { action, email, permission } = payload;
  if (action !== "grant" && action !== "revoke") {
    return jsonResponse(400, { error: 'action must be "grant" or "revoke"' });
  }
  if (!email) {
    return jsonResponse(400, { error: "email is required" });
  }

  const folder = await ddb.send(new GetCommand({ TableName: FOLDERS_TABLE_NAME, Key: { folderId } }));
  if (!folder.Item) return jsonResponse(404, { error: "Folder not found" });

  const userId = await subForEmail(email);
  if (!userId) return jsonResponse(404, { error: `No account found for ${email}` });

  if (action === "revoke") {
    await ddb.send(new DeleteCommand({ TableName: FOLDER_SHARES_TABLE_NAME, Key: { folderId, userId } }));
    return jsonResponse(200, { folderId, email, revoked: true });
  }

  if (!permission || !VALID_PERMISSIONS.has(permission)) {
    return jsonResponse(400, { error: `permission must be one of: ${[...VALID_PERMISSIONS].join(", ")}` });
  }

  const item = { folderId, userId, email, permission, grantedAt: new Date().toISOString() };
  await ddb.send(new PutCommand({ TableName: FOLDER_SHARES_TABLE_NAME, Item: item }));
  return jsonResponse(200, item);
}

async function getPermissionsMatrix(): Promise<APIGatewayProxyStructuredResultV2> {
  const [foldersResult, sharesResult, friendsResult] = await Promise.all([
    ddb.send(new ScanCommand({ TableName: FOLDERS_TABLE_NAME })),
    ddb.send(new ScanCommand({ TableName: FOLDER_SHARES_TABLE_NAME })),
    cognito.send(new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID, GroupName: "Member" })),
  ]);

  const friends = (friendsResult.Users ?? []).map((u) => ({
    // Username is Cognito's auto-generated UUID (equal to sub) even with
    // UsernameAttributes: [email] configured — email only works as an
    // alias for sign-in/Admin-API lookups, it's never the literal
    // Username. Pull the real address from the attribute, not u.Username.
    userId: u.Attributes?.find((a) => a.Name === "sub")?.Value,
    email: u.Attributes?.find((a) => a.Name === "email")?.Value,
    enabled: u.Enabled,
    status: u.UserStatus,
  }));

  return jsonResponse(200, {
    folders: foldersResult.Items ?? [],
    shares: sharesResult.Items ?? [],
    friends,
  });
}
