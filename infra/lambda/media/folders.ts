import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyHandlerV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const FOLDERS_TABLE_NAME = process.env.FOLDERS_TABLE_NAME!;
const MEDIA_TABLE_NAME = process.env.MEDIA_TABLE_NAME!;
const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME!;

// Sentinel parentFolderId for top-level folders — keeps every folder
// queryable through the same byParent GSI (DynamoDB GSIs skip items
// missing the indexed attribute, so root folders can't just omit it).
const ROOT = "ROOT";
const THUMBNAIL_URL_EXPIRY_SECONDS = 900;

const jsonResponse = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * Folder visibility isn't scoped by FolderShares yet (that's Phase 3) — until
 * that table exists to enforce per-friend access, only the Owner can create
 * or browse folders at all. Opening this up to any authenticated Member
 * before then would let friends see every folder, not just ones shared
 * with them.
 */
function isOwner(claims: APIGatewayProxyEventV2WithJWTAuthorizer["requestContext"]["authorizer"]["jwt"]["claims"]): boolean {
  const groups = claims["cognito:groups"];
  if (Array.isArray(groups)) return groups.includes("Owner");
  if (typeof groups === "string") {
    try {
      const parsed = JSON.parse(groups);
      if (Array.isArray(parsed)) return parsed.includes("Owner");
    } catch {
      // Not JSON — fall through to a plain comma-split check below.
    }
    return groups.split(",").map((g) => g.trim()).includes("Owner");
  }
  return false;
}

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  if (!isOwner(event.requestContext.authorizer.jwt.claims)) {
    return jsonResponse(403, { error: "Owner access required" });
  }

  switch (event.routeKey) {
    case "POST /folders":
      return createFolder(event);
    case "GET /folders":
      return listFolders(event);
    case "GET /folders/{folderId}":
      return getFolder(event);
    case "GET /folders/{folderId}/media":
      return listFolderMedia(event);
    default:
      return jsonResponse(404, { error: "Not found" });
  }
};

async function createFolder(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  let payload: { title?: string; parentFolderId?: string; date?: string; guestUploadEnabled?: boolean };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { title, date, guestUploadEnabled } = payload;
  const parentFolderId = payload.parentFolderId ?? ROOT;
  if (!title) {
    return jsonResponse(400, { error: "title is required" });
  }

  if (parentFolderId !== ROOT) {
    const parent = await ddb.send(new GetCommand({ TableName: FOLDERS_TABLE_NAME, Key: { folderId: parentFolderId } }));
    if (!parent.Item) {
      return jsonResponse(400, { error: `parentFolderId ${parentFolderId} does not exist` });
    }
  }

  const item = {
    folderId: randomUUID(),
    parentFolderId,
    title,
    date: date ?? null,
    guestUploadEnabled: guestUploadEnabled ?? false,
    coverThumbnail: null,
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: FOLDERS_TABLE_NAME, Item: item }));
  return jsonResponse(201, item);
}

async function listFolders(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  const parentFolderId = event.queryStringParameters?.parentId ?? ROOT;
  const result = await ddb.send(
    new QueryCommand({
      TableName: FOLDERS_TABLE_NAME,
      IndexName: "byParent",
      KeyConditionExpression: "parentFolderId = :p",
      ExpressionAttributeValues: { ":p": parentFolderId },
    })
  );
  return jsonResponse(200, { folders: result.Items ?? [] });
}

async function getFolder(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  const folderId = event.pathParameters?.folderId;
  if (!folderId) return jsonResponse(400, { error: "folderId is required" });

  const result = await ddb.send(new GetCommand({ TableName: FOLDERS_TABLE_NAME, Key: { folderId } }));
  if (!result.Item) return jsonResponse(404, { error: "Folder not found" });
  return jsonResponse(200, result.Item);
}

async function listFolderMedia(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  const folderId = event.pathParameters?.folderId;
  if (!folderId) return jsonResponse(400, { error: "folderId is required" });

  const result = await ddb.send(
    new QueryCommand({
      TableName: MEDIA_TABLE_NAME,
      IndexName: "byFolder",
      KeyConditionExpression: "folderId = :f",
      ExpressionAttributeValues: { ":f": folderId },
    })
  );

  const media = await Promise.all(
    (result.Items ?? []).map(async (item) => ({
      ...item,
      thumbnailUrl: item.thumbnailKey
        ? await getSignedUrl(s3, new GetObjectCommand({ Bucket: MEDIA_BUCKET_NAME, Key: item.thumbnailKey }), {
            expiresIn: THUMBNAIL_URL_EXPIRY_SECONDS,
          })
        : null,
    }))
  );

  return jsonResponse(200, { media });
}
