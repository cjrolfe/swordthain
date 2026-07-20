import type { APIGatewayProxyHandlerV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { isOwner } from "./authz";
import { resolveAccess } from "./access";
import { jsonResponse } from "./http";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const FOLDERS_TABLE_NAME = process.env.FOLDERS_TABLE_NAME!;
const FOLDER_SHARES_TABLE_NAME = process.env.FOLDER_SHARES_TABLE_NAME!;
const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME!;
// Single presigned PUT (S3's hard limit is 5GB per PUT). Long enough that a
// large video doesn't outlive the signature mid-transfer on a slow link.
// True multipart upload (for files that need resumability) is a fast-follow.
const UPLOAD_URL_EXPIRY_SECONDS = 3600;

const SUPPORTED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
]);

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  let payload: { folderId?: string; fileName?: string; contentType?: string };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { folderId, fileName, contentType } = payload;
  if (!folderId || !fileName || !contentType) {
    return jsonResponse(400, { error: "folderId, fileName, and contentType are required" });
  }
  if (!SUPPORTED_CONTENT_TYPES.has(contentType)) {
    return jsonResponse(400, { error: `Unsupported contentType: ${contentType}` });
  }

  const owner = isOwner(event.requestContext.authorizer.jwt.claims);
  const userId = event.requestContext.authorizer.jwt.claims.sub as string;

  if (owner) {
    const folder = await ddb.send(new GetCommand({ TableName: FOLDERS_TABLE_NAME, Key: { folderId } }));
    if (!folder.Item) return jsonResponse(400, { error: `folderId ${folderId} does not exist` });
  } else {
    // Friends can only upload to a folder they (or an ancestor) have been
    // explicitly given "upload" permission on — view/download access alone
    // doesn't allow contributing media. Guest-upload-per-album toggling is
    // a later phase; this is the underlying enforcement it'll build on.
    const access = await resolveAccess(ddb, FOLDERS_TABLE_NAME, FOLDER_SHARES_TABLE_NAME, folderId, userId);
    if (!access || access.permission !== "upload") {
      return jsonResponse(403, { error: "Upload permission required for this folder" });
    }
  }

  const mediaId = randomUUID();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const s3Key = `originals/${folderId}/${mediaId}/${sanitizedFileName}`;

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: MEDIA_BUCKET_NAME, Key: s3Key, ContentType: contentType }),
    { expiresIn: UPLOAD_URL_EXPIRY_SECONDS }
  );

  return jsonResponse(200, { mediaId, s3Key, uploadUrl, expiresIn: UPLOAD_URL_EXPIRY_SECONDS });
};
