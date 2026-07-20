import type { APIGatewayProxyHandlerV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
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
