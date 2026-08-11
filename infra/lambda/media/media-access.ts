import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyHandlerV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { isOwner } from "./authz";
import { hasPermission, resolveAccess } from "./access";
import { jsonResponse } from "./http";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const FOLDERS_TABLE_NAME = process.env.FOLDERS_TABLE_NAME!;
const FOLDER_SHARES_TABLE_NAME = process.env.FOLDER_SHARES_TABLE_NAME!;
const MEDIA_TABLE_NAME = process.env.MEDIA_TABLE_NAME!;
const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME!;
const ACTIVITY_LOG_TABLE_NAME = process.env.ACTIVITY_LOG_TABLE_NAME!;

// Short-lived — reissued on every view/download rather than cached client-side.
const URL_EXPIRY_SECONDS = 300;

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const mediaId = event.pathParameters?.mediaId;
  if (!mediaId) return jsonResponse(400, { error: "mediaId is required" });

  if (event.routeKey === "DELETE /media/{mediaId}") {
    return deleteMedia(event, mediaId);
  }
  if (event.routeKey === "PATCH /media/{mediaId}") {
    return updateMedia(event, mediaId);
  }

  const action = event.routeKey === "GET /media/{mediaId}/download-url" ? "download" : "view";

  const owner = isOwner(event.requestContext.authorizer.jwt.claims);
  const userId = event.requestContext.authorizer.jwt.claims.sub as string;

  const media = await ddb.send(new GetCommand({ TableName: MEDIA_TABLE_NAME, Key: { mediaId } }));
  if (!media.Item) return jsonResponse(404, { error: "Media not found" });

  if (!owner) {
    const access = await resolveAccess(ddb, FOLDERS_TABLE_NAME, FOLDER_SHARES_TABLE_NAME, media.Item.folderId, userId);
    if (!access || !hasPermission(access.permission, action)) {
      return jsonResponse(403, { error: `${action} permission required for this folder` });
    }
  }

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: MEDIA_BUCKET_NAME,
      Key: media.Item.s3Key,
      ...(action === "download"
        ? { ResponseContentDisposition: `attachment; filename="${media.Item.fileName}"` }
        : {}),
    }),
    { expiresIn: URL_EXPIRY_SECONDS }
  );

  await ddb.send(
    new PutCommand({
      TableName: ACTIVITY_LOG_TABLE_NAME,
      Item: {
        logId: randomUUID(),
        userId,
        mediaId,
        folderId: media.Item.folderId,
        action,
        timestamp: new Date().toISOString(),
      },
    })
  );

  return jsonResponse(200, { url, expiresIn: URL_EXPIRY_SECONDS });
};

async function deleteMedia(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  mediaId: string
): Promise<APIGatewayProxyStructuredResultV2> {
  const owner = isOwner(event.requestContext.authorizer.jwt.claims);
  if (!owner) return jsonResponse(403, { error: "Owner access required" });

  const media = await ddb.send(new GetCommand({ TableName: MEDIA_TABLE_NAME, Key: { mediaId } }));
  if (!media.Item) return jsonResponse(404, { error: "Media not found" });

  await s3.send(
    new DeleteObjectsCommand({
      Bucket: MEDIA_BUCKET_NAME,
      Delete: { Objects: [{ Key: media.Item.s3Key }, { Key: media.Item.thumbnailKey }] },
    })
  );

  await ddb.send(new DeleteCommand({ TableName: MEDIA_TABLE_NAME, Key: { mediaId } }));

  return jsonResponse(200, { mediaId, deleted: true });
}

const DESCRIPTION_MAX_LENGTH = 140;

async function updateMedia(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  mediaId: string
): Promise<APIGatewayProxyStructuredResultV2> {
  const owner = isOwner(event.requestContext.authorizer.jwt.claims);
  if (!owner) return jsonResponse(403, { error: "Owner access required" });

  let payload: { description?: string };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  if (typeof payload.description !== "string") {
    return jsonResponse(400, { error: "description is required" });
  }
  const description = payload.description.trim();
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    return jsonResponse(400, { error: `description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer` });
  }

  const media = await ddb.send(new GetCommand({ TableName: MEDIA_TABLE_NAME, Key: { mediaId } }));
  if (!media.Item) return jsonResponse(404, { error: "Media not found" });

  const result = await ddb.send(
    new UpdateCommand({
      TableName: MEDIA_TABLE_NAME,
      Key: { mediaId },
      UpdateExpression: "SET description = :d",
      ExpressionAttributeValues: { ":d": description },
      ReturnValues: "ALL_NEW",
    })
  );

  return jsonResponse(200, result.Attributes);
}
