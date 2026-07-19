import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

const s3 = new S3Client({});

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

const jsonResponse = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
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
