import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyHandlerV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
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
// Files over that limit use the multipart/* routes below instead.
const UPLOAD_URL_EXPIRY_SECONDS = 3600;
// 50MB — comfortably above S3's 5MB-per-part minimum, keeps part count
// well under the 10,000-part ceiling even for very large files (a 100GB
// file is ~2,000 parts).
const MULTIPART_PART_SIZE = 50 * 1024 * 1024;

const SUPPORTED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
]);

/**
 * Owner always allowed (folder existence still validated). A Member is
 * allowed with an explicit "upload" share, OR — if the folder itself has
 * guestUploadEnabled — with any existing share at all (view/download/upload)
 * on that exact folder. guestUploadEnabled is deliberately not inherited
 * from a parent folder, matching every other folder-specific field.
 * Returns an error response to short-circuit with, or null if allowed.
 */
async function checkUploadPermission(
  owner: boolean,
  userId: string,
  folderId: string
): Promise<APIGatewayProxyStructuredResultV2 | null> {
  if (owner) {
    const folder = await ddb.send(new GetCommand({ TableName: FOLDERS_TABLE_NAME, Key: { folderId } }));
    if (!folder.Item) return jsonResponse(400, { error: `folderId ${folderId} does not exist` });
    return null;
  }

  const access = await resolveAccess(ddb, FOLDERS_TABLE_NAME, FOLDER_SHARES_TABLE_NAME, folderId, userId);
  if (!access) return jsonResponse(403, { error: "No access to this folder" });
  if (access.permission === "upload") return null;

  const folder = await ddb.send(new GetCommand({ TableName: FOLDERS_TABLE_NAME, Key: { folderId } }));
  if (!folder.Item?.guestUploadEnabled) {
    return jsonResponse(403, { error: "Upload permission required for this folder" });
  }
  return null;
}

function buildS3Key(folderId: string, mediaId: string, fileName: string): string {
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `originals/${folderId}/${mediaId}/${sanitizedFileName}`;
}

function claims(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const owner = isOwner(event.requestContext.authorizer.jwt.claims);
  const userId = event.requestContext.authorizer.jwt.claims.sub as string;
  return { owner, userId };
}

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  switch (event.routeKey) {
    case "POST /media/upload-url":
      return getUploadUrl(event);
    case "POST /media/upload-url/multipart/init":
      return initMultipartUpload(event);
    case "POST /media/upload-url/multipart/part-url":
      return getMultipartPartUrl(event);
    case "POST /media/upload-url/multipart/complete":
      return completeMultipartUpload(event);
    case "POST /media/upload-url/multipart/abort":
      return abortMultipartUpload(event);
    default:
      return jsonResponse(404, { error: "Not found" });
  }
};

async function getUploadUrl(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
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

  const { owner, userId } = claims(event);
  const permissionError = await checkUploadPermission(owner, userId, folderId);
  if (permissionError) return permissionError;

  const mediaId = randomUUID();
  const s3Key = buildS3Key(folderId, mediaId, fileName);

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: MEDIA_BUCKET_NAME, Key: s3Key, ContentType: contentType }),
    { expiresIn: UPLOAD_URL_EXPIRY_SECONDS }
  );

  return jsonResponse(200, { mediaId, s3Key, uploadUrl, expiresIn: UPLOAD_URL_EXPIRY_SECONDS });
}

async function initMultipartUpload(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  let payload: { folderId?: string; fileName?: string; contentType?: string; fileSize?: number };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { folderId, fileName, contentType, fileSize } = payload;
  if (!folderId || !fileName || !contentType || !fileSize) {
    return jsonResponse(400, { error: "folderId, fileName, contentType, and fileSize are required" });
  }
  if (!SUPPORTED_CONTENT_TYPES.has(contentType)) {
    return jsonResponse(400, { error: `Unsupported contentType: ${contentType}` });
  }

  const { owner, userId } = claims(event);
  const permissionError = await checkUploadPermission(owner, userId, folderId);
  if (permissionError) return permissionError;

  const mediaId = randomUUID();
  const s3Key = buildS3Key(folderId, mediaId, fileName);

  const created = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: MEDIA_BUCKET_NAME, Key: s3Key, ContentType: contentType })
  );
  if (!created.UploadId) return jsonResponse(502, { error: "S3 did not return an upload ID" });

  return jsonResponse(200, {
    mediaId,
    s3Key,
    uploadId: created.UploadId,
    partSize: MULTIPART_PART_SIZE,
    totalParts: Math.ceil(fileSize / MULTIPART_PART_SIZE),
  });
}

async function getMultipartPartUrl(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  let payload: { folderId?: string; s3Key?: string; uploadId?: string; partNumber?: number };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { folderId, s3Key, uploadId, partNumber } = payload;
  if (!folderId || !s3Key || !uploadId || !partNumber) {
    return jsonResponse(400, { error: "folderId, s3Key, uploadId, and partNumber are required" });
  }

  const { owner, userId } = claims(event);
  const permissionError = await checkUploadPermission(owner, userId, folderId);
  if (permissionError) return permissionError;

  const url = await getSignedUrl(
    s3,
    new UploadPartCommand({ Bucket: MEDIA_BUCKET_NAME, Key: s3Key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn: UPLOAD_URL_EXPIRY_SECONDS }
  );

  return jsonResponse(200, { url });
}

async function completeMultipartUpload(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  let payload: { folderId?: string; s3Key?: string; uploadId?: string; parts?: { partNumber: number; etag: string }[] };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { folderId, s3Key, uploadId, parts } = payload;
  if (!folderId || !s3Key || !uploadId || !Array.isArray(parts) || parts.length === 0) {
    return jsonResponse(400, { error: "folderId, s3Key, uploadId, and a non-empty parts array are required" });
  }

  const { owner, userId } = claims(event);
  const permissionError = await checkUploadPermission(owner, userId, folderId);
  if (permissionError) return permissionError;

  try {
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: MEDIA_BUCKET_NAME,
        Key: s3Key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
      })
    );
  } catch (err) {
    // A stale/wrong part list surfaces as a real S3 error here — an honest
    // failure mode rather than something silently swallowed client-side.
    return jsonResponse(502, { error: "Failed to complete upload", detail: err instanceof Error ? err.message : String(err) });
  }

  return jsonResponse(200, { completed: true });
}

async function abortMultipartUpload(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  let payload: { folderId?: string; s3Key?: string; uploadId?: string };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { folderId, s3Key, uploadId } = payload;
  if (!folderId || !s3Key || !uploadId) {
    return jsonResponse(400, { error: "folderId, s3Key, and uploadId are required" });
  }

  const { owner, userId } = claims(event);
  const permissionError = await checkUploadPermission(owner, userId, folderId);
  if (permissionError) return permissionError;

  await s3.send(new AbortMultipartUploadCommand({ Bucket: MEDIA_BUCKET_NAME, Key: s3Key, UploadId: uploadId }));
  return jsonResponse(200, { aborted: true });
}
