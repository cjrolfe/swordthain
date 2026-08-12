import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { CI_TEST_FOLDER_ID, MEDIA_TABLE_NAME } from "./config.js";

// media-items lives in eu-west-1 regardless of the Cognito client's region
// (Cognito is us-east-1, the media data plane is eu-west-1 — see
// infra/README.md's "Region split" section), so this is pinned independently.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "eu-west-1" }));

/**
 * Inserts a synthetic "video" MediaItems row directly, bypassing a real
 * upload. Playlists are video-only, but no locally-generated test video
 * has been found that the deployed (2018-vintage static) ffmpeg layer can
 * read the pixel format from — real video upload/thumbnailing is already
 * exercised whenever a real video is uploaded through the app, and photo
 * upload/thumbnailing is covered end-to-end by scenarios/media.ts. This
 * fixture exists purely to give the playlist-CRUD scenario a valid
 * mediaId to add/remove — it deliberately doesn't touch S3 or ThumbnailFn.
 */
export async function createSyntheticVideoItem(fileName: string): Promise<string> {
  const mediaId = randomUUID();
  await ddb.send(
    new PutCommand({
      TableName: MEDIA_TABLE_NAME,
      Item: {
        mediaId,
        folderId: CI_TEST_FOLDER_ID,
        folderIdType: `${CI_TEST_FOLDER_ID}#video`,
        type: "video",
        s3Key: `originals/${CI_TEST_FOLDER_ID}/${mediaId}/${fileName}`,
        thumbnailKey: `thumbnails/${CI_TEST_FOLDER_ID}/${mediaId}.jpg`,
        contentType: "video/mp4",
        sizeBytes: 0,
        fileName,
        status: "ready",
        uploadedAt: new Date().toISOString(),
      },
    })
  );
  return mediaId;
}

export async function deleteMediaItemRow(mediaId: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: MEDIA_TABLE_NAME, Key: { mediaId } }));
}
