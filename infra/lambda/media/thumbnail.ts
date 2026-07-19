import type { S3Handler } from "aws-lambda";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import sharp from "sharp";

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MEDIA_TABLE_NAME = process.env.MEDIA_TABLE_NAME!;
const THUMBNAIL_SIZE = 400;

// Sharp's prebuilt Lambda binary excludes HEIF support (libheif licensing),
// so HEIC/HEIF stills are routed through ffmpeg instead of Sharp.
const SHARP_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);
const FFMPEG_IMAGE_TYPES = new Set(["image/heic", "image/heif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);

const KEY_PATTERN = /^originals\/([^/]+)\/([^/]+)\/(.+)$/;

export const handler: S3Handler = async (event) => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

    const match = key.match(KEY_PATTERN);
    if (!match) {
      console.warn(`Key ${key} doesn't match originals/{folderId}/{mediaId}/{fileName}, skipping`);
      continue;
    }
    const [, folderId, mediaId, fileName] = match;

    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const contentType = head.ContentType ?? "application/octet-stream";
    const sizeBytes = head.ContentLength ?? 0;

    const original = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const originalBuffer = Buffer.from(await original.Body!.transformToByteArray());

    let thumbnailBuffer: Buffer;
    let mediaType: "photo" | "video";

    if (SHARP_IMAGE_TYPES.has(contentType)) {
      mediaType = "photo";
      thumbnailBuffer = await sharp(originalBuffer)
        .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "inside" })
        .jpeg({ quality: 80 })
        .toBuffer();
    } else if (FFMPEG_IMAGE_TYPES.has(contentType)) {
      mediaType = "photo";
      thumbnailBuffer = extractFrameWithFfmpeg(originalBuffer, fileName, "0");
    } else if (VIDEO_TYPES.has(contentType)) {
      mediaType = "video";
      thumbnailBuffer = extractFrameWithFfmpeg(originalBuffer, fileName, "00:00:01");
    } else {
      console.warn(`Unsupported content type ${contentType} for ${key}, skipping`);
      continue;
    }

    const thumbnailKey = `thumbnails/${folderId}/${mediaId}.jpg`;
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: thumbnailKey,
        Body: thumbnailBuffer,
        ContentType: "image/jpeg",
      })
    );

    await ddb.send(
      new PutCommand({
        TableName: MEDIA_TABLE_NAME,
        Item: {
          mediaId,
          folderId,
          type: mediaType,
          s3Key: key,
          thumbnailKey,
          contentType,
          sizeBytes,
          fileName,
          status: "ready",
          uploadedAt: new Date().toISOString(),
        },
      })
    );
  }
};

function extractFrameWithFfmpeg(inputBuffer: Buffer, fileName: string, timestamp: string): Buffer {
  const ext = path.extname(fileName) || ".bin";
  const inputPath = `/tmp/${randomUUID()}${ext}`;
  const outputPath = `/tmp/${randomUUID()}.jpg`;
  fs.writeFileSync(inputPath, inputBuffer);
  try {
    execFileSync("/opt/bin/ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-ss",
      timestamp,
      "-frames:v",
      "1",
      "-vf",
      `scale=${THUMBNAIL_SIZE}:-1`,
      outputPath,
    ]);
    return fs.readFileSync(outputPath);
  } finally {
    fs.rmSync(inputPath, { force: true });
    fs.rmSync(outputPath, { force: true });
  }
}
