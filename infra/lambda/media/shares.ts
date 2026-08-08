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
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
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
// Same asset invites.ts already uses — content-hashed by the media-app
// build, stable across deploys as long as the source image isn't replaced.
const FILM_STRIP_IMAGE_URL = "https://swordthain.com/assets/film-strip-bg-7vcpve4Y.jpg";

const VALID_PERMISSIONS = new Set(["view", "download", "upload"]);
const MAX_NOTIFY_FOLDER_IDS = 50;

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
    case "POST /admin/notify-shares":
      return notifyShares(event);
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

async function notifyShares(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  let payload: { email?: string; folderIds?: string[]; message?: string };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { email, folderIds, message } = payload;
  if (!email) return jsonResponse(400, { error: "email is required" });
  if (!Array.isArray(folderIds) || folderIds.length === 0) {
    return jsonResponse(400, { error: "folderIds must be a non-empty array" });
  }
  if (folderIds.length > MAX_NOTIFY_FOLDER_IDS) {
    return jsonResponse(400, { error: "Too many folderIds in one request" });
  }

  const userId = await subForEmail(email);
  if (!userId) return jsonResponse(404, { error: `No account found for ${email}` });

  // Never trust the client's claim that a folder was shared — validate each
  // folderId against a real, current share record before any folder title
  // reaches an email.
  const results = await Promise.all(
    folderIds.map(async (folderId) => {
      const share = await ddb.send(new GetCommand({ TableName: FOLDER_SHARES_TABLE_NAME, Key: { folderId, userId } }));
      return { folderId, hasShare: !!share.Item };
    })
  );
  const validFolderIds = results.filter((r) => r.hasShare).map((r) => r.folderId);
  const invalidFolderIds = results.filter((r) => !r.hasShare).map((r) => r.folderId);

  if (validFolderIds.length === 0) {
    return jsonResponse(400, {
      error: "None of the provided folderIds have a current share for this email",
      invalidFolderIds,
    });
  }

  const folders = await Promise.all(
    validFolderIds.map((folderId) => ddb.send(new GetCommand({ TableName: FOLDERS_TABLE_NAME, Key: { folderId } })))
  );
  const folderTitles = folders.map((f) => f.Item?.title as string | undefined).filter((t): t is string => !!t);
  if (folderTitles.length === 0) {
    return jsonResponse(404, { error: "Shared folders no longer exist" });
  }

  await sendNewMediaEmail(email, folderTitles, message);

  return jsonResponse(200, { email, notifiedFolderIds: validFolderIds, invalidFolderIds });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendNewMediaEmail(email: string, folderTitles: string[], personalMessage: string | undefined): Promise<void> {
  const folderList = folderTitles.map((t) => `- ${t}`).join("\n");
  const personalParagraph = personalMessage ? `\n${personalMessage}\n` : "";
  const text =
    `New media has been shared with you on Swordthain.\n\n` +
    `The following folder(s) are now available for you to view:\n${folderList}\n` +
    personalParagraph +
    `\nGo to ${SITE_URL} to take a look.`;

  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: SES_FROM_ADDRESS,
      Destination: { ToAddresses: [email] },
      Content: {
        Simple: {
          Subject: { Data: "New media shared with you on Swordthain" },
          Body: {
            Text: { Data: text },
            Html: { Data: buildNewMediaEmailHtml(email, folderTitles, personalMessage) },
          },
        },
      },
    })
  );
}

function buildNewMediaEmailHtml(email: string, folderTitles: string[], personalMessage: string | undefined): string {
  const folderRows = folderTitles
    .map(
      (title) => `
                    <tr>
                      <td style="padding:0 0 10px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td width="8" valign="middle" style="padding:0 12px 0 2px;">
                              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                                <tr><td width="6" height="6" style="background:#4a7dff;border-radius:3px;font-size:0;line-height:0;">&nbsp;</td></tr>
                              </table>
                            </td>
                            <td valign="middle" style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#f0ece4;">
                              ${escapeHtml(title)}
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>`
    )
    .join("");

  const personalMessageRow = personalMessage
    ? `<tr>
        <td style="padding:0 0 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="background:rgba(255,255,255,0.04);border-left:3px solid #4a7dff;padding:14px 18px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-style:italic;line-height:1.55;color:#d8d4ca;">
                "${escapeHtml(personalMessage)}"
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b0f12;">
  <tr>
    <td align="center" style="padding:28px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;">
        <tr>
          <td>
            <img src="${FILM_STRIP_IMAGE_URL}" width="560" alt="" style="display:block;width:100%;max-width:560px;height:auto;border:0;" />
          </td>
        </tr>
        <tr>
          <td style="background:#1c1d1f;padding:40px 36px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:Georgia,'Times New Roman',serif;font-size:32px;line-height:1.2;color:#f5f2ea;letter-spacing:0.01em;padding:0 0 6px;">
                  Swordthain
                </td>
              </tr>
              <tr>
                <td style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;color:#a9a59c;padding:0 0 28px;">
                  Family movies, straight from the vault.
                </td>
              </tr>
              <tr>
                <td style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#f0ece4;padding:0 0 20px;">
                  New media has been shared with you on Swordthain.
                </td>
              </tr>
              <tr>
                <td style="padding:0 0 24px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    ${folderRows}
                  </table>
                </td>
              </tr>
              ${personalMessageRow}
              <tr>
                <td style="padding:4px 0 4px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background:#4a7dff;border-radius:8px;">
                        <a href="${SITE_URL}" style="display:inline-block;padding:14px 34px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">Open Swordthain</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 20px 4px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#5f5e5a;text-align:center;">
            This was sent to ${escapeHtml(email)} because folders were shared with your account. If you weren't expecting this, contact whoever shared it with you.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}
