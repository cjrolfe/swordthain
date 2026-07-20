import type { APIGatewayProxyHandlerV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { CognitoIdentityProviderClient, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";
import { isOwner } from "./authz";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});

const ACTIVITY_LOG_TABLE_NAME = process.env.ACTIVITY_LOG_TABLE_NAME!;
const MEDIA_TABLE_NAME = process.env.MEDIA_TABLE_NAME!;
const FOLDERS_TABLE_NAME = process.env.FOLDERS_TABLE_NAME!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

const RESULT_LIMIT = 200;

const jsonResponse = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

interface ActivityLogItem {
  logId: string;
  userId: string;
  mediaId: string;
  folderId: string;
  action: "view" | "download";
  timestamp: string;
}

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  if (!isOwner(event.requestContext.authorizer.jwt.claims)) {
    return jsonResponse(403, { error: "Owner access required" });
  }

  const folderId = event.queryStringParameters?.folderId;
  const userId = event.queryStringParameters?.userId;
  if (!folderId && !userId) {
    return jsonResponse(400, { error: "folderId or userId query parameter is required" });
  }

  let items: ActivityLogItem[];
  if (folderId) {
    const result = await ddb.send(
      new QueryCommand({
        TableName: ACTIVITY_LOG_TABLE_NAME,
        IndexName: "byFolder",
        KeyConditionExpression: "folderId = :f",
        ExpressionAttributeValues: { ":f": folderId },
        ScanIndexForward: false,
        Limit: RESULT_LIMIT,
      })
    );
    items = (result.Items ?? []) as ActivityLogItem[];
    if (userId) items = items.filter((i) => i.userId === userId);
  } else {
    const result = await ddb.send(
      new QueryCommand({
        TableName: ACTIVITY_LOG_TABLE_NAME,
        IndexName: "byUser",
        KeyConditionExpression: "userId = :u",
        ExpressionAttributeValues: { ":u": userId },
        ScanIndexForward: false,
        Limit: RESULT_LIMIT,
      })
    );
    items = (result.Items ?? []) as ActivityLogItem[];
  }

  const [fileNames, emails, folderTitles] = await Promise.all([
    resolveFileNames(items),
    resolveEmails(items),
    resolveFolderTitles(items),
  ]);

  const enriched = items.map((item) => ({
    ...item,
    email: emails.get(item.userId) ?? item.userId,
    fileName: fileNames.get(item.mediaId) ?? item.mediaId,
    folderTitle: folderTitles.get(item.folderId) ?? item.folderId,
  }));

  return jsonResponse(200, { activity: enriched });
};

const definedValue = <K,>(entry: readonly [K, string | undefined]): entry is [K, string] => entry[1] !== undefined;

async function resolveFileNames(items: ActivityLogItem[]): Promise<Map<string, string>> {
  const uniqueMediaIds = [...new Set(items.map((i) => i.mediaId))];
  const entries = await Promise.all(
    uniqueMediaIds.map(async (mediaId) => {
      const media = await ddb.send(new GetCommand({ TableName: MEDIA_TABLE_NAME, Key: { mediaId } }));
      return [mediaId, media.Item?.fileName as string | undefined] as const;
    })
  );
  return new Map(entries.filter(definedValue));
}

async function resolveFolderTitles(items: ActivityLogItem[]): Promise<Map<string, string>> {
  const uniqueFolderIds = [...new Set(items.map((i) => i.folderId))];
  const entries = await Promise.all(
    uniqueFolderIds.map(async (folderId) => {
      const folder = await ddb.send(new GetCommand({ TableName: FOLDERS_TABLE_NAME, Key: { folderId } }));
      return [folderId, folder.Item?.title as string | undefined] as const;
    })
  );
  return new Map(entries.filter(definedValue));
}

async function resolveEmails(items: ActivityLogItem[]): Promise<Map<string, string>> {
  const uniqueUserIds = [...new Set(items.map((i) => i.userId))];
  const entries = await Promise.all(
    uniqueUserIds.map(async (userId) => {
      try {
        const result = await cognito.send(
          new ListUsersCommand({ UserPoolId: USER_POOL_ID, Filter: `sub = "${userId}"`, Limit: 1 })
        );
        const email = result.Users?.[0]?.Attributes?.find((a) => a.Name === "email")?.Value;
        return [userId, email] as const;
      } catch {
        return [userId, undefined] as const;
      }
    })
  );
  return new Map(entries.filter(definedValue));
}
