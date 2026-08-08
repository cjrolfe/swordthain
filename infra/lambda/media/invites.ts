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
// Content-hashed by the media-app build; stable across deploys as long as
// the source film-strip-bg.jpg itself isn't replaced.
const FILM_STRIP_IMAGE_URL = "https://swordthain.com/assets/film-strip-bg-7vcpve4Y.jpg";

const VALID_PERMISSIONS = new Set(["view", "download", "upload"]);

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  if (!isOwner(event.requestContext.authorizer.jwt.claims)) {
    return jsonResponse(403, { error: "Owner access required" });
  }

  if (event.routeKey === "POST /admin/invites/preview") {
    return previewInvite(event);
  }
  return sendInvite(event);
};

async function sendInvite(event: Parameters<APIGatewayProxyHandlerV2WithJWTAuthorizer>[0]) {
  let payload: { email?: string; folderId?: string; permission?: string; message?: string; subject?: string };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { email, folderId, permission, message, subject } = payload;
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

  await sendInviteEmail(email, message, subject);

  return jsonResponse(201, { userId: sub, email, folderId: folderId ?? null, permission: permission ?? null });
}

/**
 * Never sends anything — renders the exact same buildInviteEmailHtml() used
 * by the real send, so the admin UI's live preview is guaranteed
 * pixel-identical to what actually goes out, not a separately maintained
 * re-implementation of the template.
 */
async function previewInvite(event: Parameters<APIGatewayProxyHandlerV2WithJWTAuthorizer>[0]) {
  let payload: { email?: string; message?: string; subject?: string };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }
  const { email, message } = payload;
  if (!email) return jsonResponse(400, { error: "email is required" });

  return jsonResponse(200, { html: buildInviteEmailHtml(email, message) });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendInviteEmail(
  email: string,
  personalMessage: string | undefined,
  subject: string | undefined
): Promise<void> {
  const personalParagraph = personalMessage ? `\n${personalMessage}\n` : "";
  const text =
    `You've been invited to Swordthain, a private photo and video site.\n` +
    personalParagraph +
    `\nGetting started:\n` +
    `1. Go to ${SITE_URL}\n` +
    `2. Enter your email address (${email})\n` +
    `3. Check your email for a 6-digit code and type it in — no password to create or remember\n` +
    `4. You're in and ready to browse\n\n` +
    `Watching on the TV? If your TV has a web browser, open ${SITE_URL} there directly — it's built to work on the big screen too.`;

  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: SES_FROM_ADDRESS,
      Destination: { ToAddresses: [email] },
      Content: {
        Simple: {
          Subject: { Data: subject?.trim() || "You're invited to Swordthain" },
          Body: {
            Text: { Data: text },
            Html: { Data: buildInviteEmailHtml(email, personalMessage) },
          },
        },
      },
    })
  );
}

function buildInviteEmailHtml(email: string, personalMessage: string | undefined): string {
  const safeEmail = escapeHtml(email);
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
                  You've been invited to Swordthain, a private photo and video site.
                </td>
              </tr>
              ${personalMessageRow}
              <tr>
                <td style="padding:0 0 8px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td width="28" valign="top" style="padding:0 12px 16px 0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td width="22" height="22" align="center" valign="middle" style="background:#4a7dff;border-radius:11px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;color:#ffffff;">1</td>
                          </tr>
                        </table>
                      </td>
                      <td valign="top" style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#e5e1d8;padding:0 0 16px;">
                        Go to <a href="${SITE_URL}" style="color:#7fa4ff;text-decoration:none;">${escapeHtml(SITE_URL.replace(/^https?:\/\//, ""))}</a>
                      </td>
                    </tr>
                    <tr>
                      <td width="28" valign="top" style="padding:0 12px 16px 0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td width="22" height="22" align="center" valign="middle" style="background:#4a7dff;border-radius:11px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;color:#ffffff;">2</td>
                          </tr>
                        </table>
                      </td>
                      <td valign="top" style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#e5e1d8;padding:0 0 16px;">
                        Enter your email address (${safeEmail})
                      </td>
                    </tr>
                    <tr>
                      <td width="28" valign="top" style="padding:0 12px 16px 0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td width="22" height="22" align="center" valign="middle" style="background:#4a7dff;border-radius:11px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;color:#ffffff;">3</td>
                          </tr>
                        </table>
                      </td>
                      <td valign="top" style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#e5e1d8;padding:0 0 16px;">
                        Check your email for a 6-digit code and enter it — no password needed
                      </td>
                    </tr>
                    <tr>
                      <td width="28" valign="top" style="padding:0 12px 0 0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td width="22" height="22" align="center" valign="middle" style="background:#4a7dff;border-radius:11px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;color:#ffffff;">4</td>
                          </tr>
                        </table>
                      </td>
                      <td valign="top" style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#e5e1d8;padding:0;">
                        You're in and ready to browse
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 0 28px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background:#4a7dff;border-radius:8px;">
                        <a href="${SITE_URL}" style="display:inline-block;padding:14px 34px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">Open Swordthain</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:0 0 4px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background:rgba(74,125,255,0.08);border:1px solid rgba(74,125,255,0.35);border-radius:8px;padding:16px 20px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#9db8ff;padding:0 0 4px;">
                              Watching on the TV?
                            </td>
                          </tr>
                          <tr>
                            <td style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14.5px;line-height:1.5;color:#dbe2f5;">
                              If your TV has a web browser, open <span style="color:#ffffff;font-weight:600;">${escapeHtml(SITE_URL.replace(/^https?:\/\//, ""))}</span> there directly — it's built to work on the big screen too.
                            </td>
                          </tr>
                        </table>
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
            This invite was sent to ${safeEmail}. If you weren't expecting this, you can ignore it.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}
