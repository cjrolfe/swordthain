import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyHandlerV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { isOwner } from "./authz";
import { ROOT, resolveAccess } from "./access";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const FOLDERS_TABLE_NAME = process.env.FOLDERS_TABLE_NAME!;
const FOLDER_SHARES_TABLE_NAME = process.env.FOLDER_SHARES_TABLE_NAME!;
const MEDIA_TABLE_NAME = process.env.MEDIA_TABLE_NAME!;
const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME!;

const THUMBNAIL_URL_EXPIRY_SECONDS = 900;

const jsonResponse = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const owner = isOwner(event.requestContext.authorizer.jwt.claims);
  const userId = event.requestContext.authorizer.jwt.claims.sub as string;

  switch (event.routeKey) {
    case "POST /folders":
      // Folder creation stays Owner-only — friends never create albums,
      // per the spec's admin-only folder management.
      if (!owner) return jsonResponse(403, { error: "Owner access required" });
      return createFolder(event);
    case "GET /folders":
      return listFolders(event, owner, userId);
    case "GET /folders/{folderId}":
      return getFolder(event, owner, userId);
    case "GET /folders/{folderId}/media":
      return listFolderMedia(event, owner, userId);
    case "PATCH /folders/{folderId}":
      if (!owner) return jsonResponse(403, { error: "Owner access required" });
      return updateFolder(event);
    case "DELETE /folders/{folderId}":
      if (!owner) return jsonResponse(403, { error: "Owner access required" });
      return deleteFolder(event);
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
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  owner: boolean,
  userId: string
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
  const children = result.Items ?? [];

  if (owner) {
    return jsonResponse(200, { folders: children });
  }

  // A friend only sees children they (or an ancestor, including this
  // parent) have been explicitly granted access to — sharing the parent
  // implies access to everything beneath it.
  const visible = await Promise.all(
    children.map(async (folder) => ({
      folder,
      access: await resolveAccess(ddb, FOLDERS_TABLE_NAME, FOLDER_SHARES_TABLE_NAME, folder.folderId, userId),
    }))
  );
  return jsonResponse(200, { folders: visible.filter((v) => v.access !== null).map((v) => v.folder) });
}

async function getFolder(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  owner: boolean,
  userId: string
): Promise<APIGatewayProxyStructuredResultV2> {
  const folderId = event.pathParameters?.folderId;
  if (!folderId) return jsonResponse(400, { error: "folderId is required" });

  if (!owner) {
    const access = await resolveAccess(ddb, FOLDERS_TABLE_NAME, FOLDER_SHARES_TABLE_NAME, folderId, userId);
    if (!access) return jsonResponse(404, { error: "Folder not found" });
  }

  const result = await ddb.send(new GetCommand({ TableName: FOLDERS_TABLE_NAME, Key: { folderId } }));
  if (!result.Item) return jsonResponse(404, { error: "Folder not found" });
  return jsonResponse(200, result.Item);
}

async function listFolderMedia(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  owner: boolean,
  userId: string
): Promise<APIGatewayProxyStructuredResultV2> {
  const folderId = event.pathParameters?.folderId;
  if (!folderId) return jsonResponse(400, { error: "folderId is required" });

  if (!owner) {
    const access = await resolveAccess(ddb, FOLDERS_TABLE_NAME, FOLDER_SHARES_TABLE_NAME, folderId, userId);
    if (!access) return jsonResponse(404, { error: "Folder not found" });
  }

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

async function updateFolder(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  const folderId = event.pathParameters?.folderId;
  if (!folderId) return jsonResponse(400, { error: "folderId is required" });

  let payload: { title?: string; date?: string; guestUploadEnabled?: boolean; coverThumbnail?: string };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const updates: Record<string, unknown> = {};
  for (const key of ["title", "date", "guestUploadEnabled", "coverThumbnail"] as const) {
    if (payload[key] !== undefined) updates[key] = payload[key];
  }
  if (Object.keys(updates).length === 0) {
    return jsonResponse(400, { error: "No updatable fields provided (title, date, guestUploadEnabled, coverThumbnail)" });
  }

  const existing = await ddb.send(new GetCommand({ TableName: FOLDERS_TABLE_NAME, Key: { folderId } }));
  if (!existing.Item) return jsonResponse(404, { error: "Folder not found" });

  const result = await ddb.send(
    new UpdateCommand({
      TableName: FOLDERS_TABLE_NAME,
      Key: { folderId },
      UpdateExpression: "SET " + Object.keys(updates).map((k, i) => `#${k} = :v${i}`).join(", "),
      ExpressionAttributeNames: Object.fromEntries(Object.keys(updates).map((k) => [`#${k}`, k])),
      ExpressionAttributeValues: Object.fromEntries(Object.keys(updates).map((k, i) => [`:v${i}`, updates[k]])),
      ReturnValues: "ALL_NEW",
    })
  );

  return jsonResponse(200, result.Attributes);
}

async function deleteFolder(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  const folderId = event.pathParameters?.folderId;
  if (!folderId) return jsonResponse(400, { error: "folderId is required" });

  const existing = await ddb.send(new GetCommand({ TableName: FOLDERS_TABLE_NAME, Key: { folderId } }));
  if (!existing.Item) return jsonResponse(404, { error: "Folder not found" });

  const [children, media] = await Promise.all([
    ddb.send(
      new QueryCommand({
        TableName: FOLDERS_TABLE_NAME,
        IndexName: "byParent",
        KeyConditionExpression: "parentFolderId = :p",
        ExpressionAttributeValues: { ":p": folderId },
        Limit: 1,
      })
    ),
    ddb.send(
      new QueryCommand({
        TableName: MEDIA_TABLE_NAME,
        IndexName: "byFolder",
        KeyConditionExpression: "folderId = :f",
        ExpressionAttributeValues: { ":f": folderId },
        Limit: 1,
      })
    ),
  ]);
  if ((children.Items?.length ?? 0) > 0) {
    return jsonResponse(409, { error: "Folder has sub-folders — move or delete them first" });
  }
  if ((media.Items?.length ?? 0) > 0) {
    return jsonResponse(409, { error: "Folder has media — delete it first" });
  }

  const shares = await ddb.send(
    new QueryCommand({
      TableName: FOLDER_SHARES_TABLE_NAME,
      KeyConditionExpression: "folderId = :f",
      ExpressionAttributeValues: { ":f": folderId },
    })
  );
  await Promise.all(
    (shares.Items ?? []).map((share) =>
      ddb.send(new DeleteCommand({ TableName: FOLDER_SHARES_TABLE_NAME, Key: { folderId, userId: share.userId } }))
    )
  );

  await ddb.send(new DeleteCommand({ TableName: FOLDERS_TABLE_NAME, Key: { folderId } }));
  return jsonResponse(200, { folderId, deleted: true });
}
