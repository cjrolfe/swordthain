import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyHandlerV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { CognitoIdentityProviderClient, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";
import { randomUUID } from "node:crypto";
import { isOwner } from "./authz";
import { hasPermission, resolveAccess } from "./access";
import { jsonResponse } from "./http";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
// This Lambda runs in eu-west-1, but the shared Cognito pool stays in
// us-east-1 — same reasoning as activity.ts.
const cognito = new CognitoIdentityProviderClient({ region: "us-east-1" });

const PLAYLISTS_TABLE_NAME = process.env.PLAYLISTS_TABLE_NAME!;
const PLAYLIST_ITEMS_TABLE_NAME = process.env.PLAYLIST_ITEMS_TABLE_NAME!;
const FOLDERS_TABLE_NAME = process.env.FOLDERS_TABLE_NAME!;
const FOLDER_SHARES_TABLE_NAME = process.env.FOLDER_SHARES_TABLE_NAME!;
const MEDIA_TABLE_NAME = process.env.MEDIA_TABLE_NAME!;
const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

const THUMBNAIL_URL_EXPIRY_SECONDS = 900;
const MAX_ITEMS_PER_PLAYLIST = 500;
const MAX_PLAYLISTS_PER_USER = 100;
const MAX_NAME_LENGTH = 100;

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const owner = isOwner(event.requestContext.authorizer.jwt.claims);
  const userId = event.requestContext.authorizer.jwt.claims.sub as string;

  switch (event.routeKey) {
    case "POST /playlists":
      return createPlaylist(event, userId);
    case "GET /playlists":
      return listPlaylists(owner, userId);
    case "GET /playlists/{playlistId}":
      return getPlaylist(event, owner, userId);
    case "GET /playlists/{playlistId}/items":
      return listPlaylistItems(event, owner, userId);
    case "PATCH /playlists/{playlistId}":
      return renamePlaylist(event, owner, userId);
    case "DELETE /playlists/{playlistId}":
      return deletePlaylist(event, owner, userId);
    case "POST /playlists/{playlistId}/items":
      return addPlaylistItem(event, owner, userId);
    case "DELETE /playlists/{playlistId}/items/{position}":
      return removePlaylistItem(event, owner, userId);
    case "PATCH /playlists/{playlistId}/items/{position}":
      return moveItem(event, owner, userId);
    default:
      return jsonResponse(404, { error: "Not found" });
  }
};

interface PlaylistRecord {
  playlistId: string;
  ownerUserId: string;
  name: string;
  itemCount: number;
  nextPosition: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Owner bypasses everything here, same convention as folders.ts — this is
 * a deliberate product decision: unlike an earlier draft of this feature,
 * playlist contents are NOT private from the Owner. A Member is only ever
 * allowed to touch their own playlists.
 */
async function loadPlaylist(
  playlistId: string,
  owner: boolean,
  userId: string
): Promise<{ playlist: PlaylistRecord } | { deny: 403 | 404 }> {
  const result = await ddb.send(new GetCommand({ TableName: PLAYLISTS_TABLE_NAME, Key: { playlistId } }));
  if (!result.Item) return { deny: 404 };
  const playlist = result.Item as PlaylistRecord;
  if (!owner && playlist.ownerUserId !== userId) return { deny: 403 };
  return { playlist };
}

function denyResponse(deny: 403 | 404) {
  return jsonResponse(deny, { error: deny === 404 ? "Playlist not found" : "Not your playlist" });
}

async function createPlaylist(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  userId: string
): Promise<APIGatewayProxyStructuredResultV2> {
  let payload: { name?: string };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }
  const name = payload.name?.trim();
  if (!name) return jsonResponse(400, { error: "name is required" });
  if (name.length > MAX_NAME_LENGTH) {
    return jsonResponse(400, { error: `name must be ${MAX_NAME_LENGTH} characters or fewer` });
  }

  const countResult = await ddb.send(
    new QueryCommand({
      TableName: PLAYLISTS_TABLE_NAME,
      IndexName: "byOwner",
      KeyConditionExpression: "ownerUserId = :u",
      ExpressionAttributeValues: { ":u": userId },
      Select: "COUNT",
    })
  );
  if ((countResult.Count ?? 0) >= MAX_PLAYLISTS_PER_USER) {
    return jsonResponse(409, { error: `You can have at most ${MAX_PLAYLISTS_PER_USER} playlists` });
  }

  const now = new Date().toISOString();
  const item: PlaylistRecord = {
    playlistId: randomUUID(),
    ownerUserId: userId,
    name,
    itemCount: 0,
    nextPosition: 0,
    createdAt: now,
    updatedAt: now,
  };
  await ddb.send(new PutCommand({ TableName: PLAYLISTS_TABLE_NAME, Item: item }));
  return jsonResponse(201, item);
}

async function listPlaylists(owner: boolean, userId: string): Promise<APIGatewayProxyStructuredResultV2> {
  if (!owner) {
    const result = await ddb.send(
      new QueryCommand({
        TableName: PLAYLISTS_TABLE_NAME,
        IndexName: "byOwner",
        KeyConditionExpression: "ownerUserId = :u",
        ExpressionAttributeValues: { ":u": userId },
        ScanIndexForward: false,
      })
    );
    return jsonResponse(200, { playlists: (result.Items ?? []).map((p) => ({ ...p, isMine: true })) });
  }

  // Owner sees every playlist, same convention as folders.ts's listFolders.
  const result = await ddb.send(new ScanCommand({ TableName: PLAYLISTS_TABLE_NAME }));
  const items = (result.Items ?? []) as PlaylistRecord[];
  const emails = await resolveEmails(items.map((p) => p.ownerUserId));
  return jsonResponse(200, {
    playlists: items.map((p) => ({
      ...p,
      ownerEmail: emails.get(p.ownerUserId) ?? p.ownerUserId,
      isMine: p.ownerUserId === userId,
    })),
  });
}

async function getPlaylist(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  owner: boolean,
  userId: string
): Promise<APIGatewayProxyStructuredResultV2> {
  const playlistId = event.pathParameters?.playlistId;
  if (!playlistId) return jsonResponse(400, { error: "playlistId is required" });
  const loaded = await loadPlaylist(playlistId, owner, userId);
  if ("deny" in loaded) return denyResponse(loaded.deny);
  return jsonResponse(200, loaded.playlist);
}

async function renamePlaylist(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  owner: boolean,
  userId: string
): Promise<APIGatewayProxyStructuredResultV2> {
  const playlistId = event.pathParameters?.playlistId;
  if (!playlistId) return jsonResponse(400, { error: "playlistId is required" });
  const loaded = await loadPlaylist(playlistId, owner, userId);
  if ("deny" in loaded) return denyResponse(loaded.deny);

  let payload: { name?: string };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }
  const name = payload.name?.trim();
  if (!name) return jsonResponse(400, { error: "name is required" });
  if (name.length > MAX_NAME_LENGTH) {
    return jsonResponse(400, { error: `name must be ${MAX_NAME_LENGTH} characters or fewer` });
  }

  const result = await ddb.send(
    new UpdateCommand({
      TableName: PLAYLISTS_TABLE_NAME,
      Key: { playlistId },
      UpdateExpression: "SET #name = :name, updatedAt = :now",
      ExpressionAttributeNames: { "#name": "name" },
      ExpressionAttributeValues: { ":name": name, ":now": new Date().toISOString() },
      ReturnValues: "ALL_NEW",
    })
  );
  return jsonResponse(200, result.Attributes);
}

async function deletePlaylist(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  owner: boolean,
  userId: string
): Promise<APIGatewayProxyStructuredResultV2> {
  const playlistId = event.pathParameters?.playlistId;
  if (!playlistId) return jsonResponse(400, { error: "playlistId is required" });
  const loaded = await loadPlaylist(playlistId, owner, userId);
  if ("deny" in loaded) return denyResponse(loaded.deny);

  const items = await ddb.send(
    new QueryCommand({
      TableName: PLAYLIST_ITEMS_TABLE_NAME,
      KeyConditionExpression: "playlistId = :p",
      ExpressionAttributeValues: { ":p": playlistId },
    })
  );
  await Promise.all(
    (items.Items ?? []).map((item) =>
      ddb.send(new DeleteCommand({ TableName: PLAYLIST_ITEMS_TABLE_NAME, Key: { playlistId, position: item.position } }))
    )
  );
  await ddb.send(new DeleteCommand({ TableName: PLAYLISTS_TABLE_NAME, Key: { playlistId } }));
  return jsonResponse(200, { playlistId, deleted: true });
}

async function listPlaylistItems(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  owner: boolean,
  userId: string
): Promise<APIGatewayProxyStructuredResultV2> {
  const playlistId = event.pathParameters?.playlistId;
  if (!playlistId) return jsonResponse(400, { error: "playlistId is required" });
  const loaded = await loadPlaylist(playlistId, owner, userId);
  if ("deny" in loaded) return denyResponse(loaded.deny);

  const result = await ddb.send(
    new QueryCommand({
      TableName: PLAYLIST_ITEMS_TABLE_NAME,
      KeyConditionExpression: "playlistId = :p",
      ExpressionAttributeValues: { ":p": playlistId },
    })
  );

  // available/accessible are advisory only, for greying out UI — the
  // authoritative gate is GET /media/{mediaId}/view-url, called fresh at
  // playback time, which re-checks access on every call with no caching.
  const enriched = await Promise.all(
    (result.Items ?? []).map(async (item) => {
      const media = await ddb.send(new GetCommand({ TableName: MEDIA_TABLE_NAME, Key: { mediaId: item.mediaId } }));
      if (!media.Item) {
        return {
          position: item.position,
          mediaId: item.mediaId,
          addedAt: item.addedAt,
          fileName: null,
          folderId: null,
          thumbnailUrl: null,
          available: false,
          accessible: false,
        };
      }
      const accessible =
        owner ||
        hasPermission(
          (await resolveAccess(ddb, FOLDERS_TABLE_NAME, FOLDER_SHARES_TABLE_NAME, media.Item.folderId, userId))
            ?.permission,
          "view"
        );
      return {
        position: item.position,
        mediaId: item.mediaId,
        addedAt: item.addedAt,
        fileName: media.Item.fileName as string,
        folderId: media.Item.folderId as string,
        thumbnailUrl: media.Item.thumbnailKey
          ? await getSignedUrl(s3, new GetObjectCommand({ Bucket: MEDIA_BUCKET_NAME, Key: media.Item.thumbnailKey }), {
              expiresIn: THUMBNAIL_URL_EXPIRY_SECONDS,
            })
          : null,
        available: true,
        accessible,
      };
    })
  );

  return jsonResponse(200, { playlistId, name: loaded.playlist.name, items: enriched });
}

async function addPlaylistItem(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  owner: boolean,
  userId: string
): Promise<APIGatewayProxyStructuredResultV2> {
  const playlistId = event.pathParameters?.playlistId;
  if (!playlistId) return jsonResponse(400, { error: "playlistId is required" });
  const loaded = await loadPlaylist(playlistId, owner, userId);
  if ("deny" in loaded) return denyResponse(loaded.deny);

  if (loaded.playlist.itemCount >= MAX_ITEMS_PER_PLAYLIST) {
    return jsonResponse(409, { error: `A playlist can have at most ${MAX_ITEMS_PER_PLAYLIST} items` });
  }

  let payload: { mediaId?: string };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }
  const mediaId = payload.mediaId;
  if (!mediaId) return jsonResponse(400, { error: "mediaId is required" });

  const media = await ddb.send(new GetCommand({ TableName: MEDIA_TABLE_NAME, Key: { mediaId } }));
  if (!media.Item) return jsonResponse(404, { error: "Media not found" });
  if (media.Item.type !== "video") return jsonResponse(400, { error: "Only videos can be added to a playlist" });

  if (!owner) {
    const access = await resolveAccess(ddb, FOLDERS_TABLE_NAME, FOLDER_SHARES_TABLE_NAME, media.Item.folderId, userId);
    if (!access || !hasPermission(access.permission, "view")) {
      return jsonResponse(403, { error: "You don't have access to this video" });
    }
  }

  const updated = await ddb.send(
    new UpdateCommand({
      TableName: PLAYLISTS_TABLE_NAME,
      Key: { playlistId },
      UpdateExpression: "ADD nextPosition :one, itemCount :one SET updatedAt = :now",
      ExpressionAttributeValues: { ":one": 1, ":now": new Date().toISOString() },
      ReturnValues: "ALL_NEW",
    })
  );
  const position = (updated.Attributes!.nextPosition as number) - 1;

  const now = new Date().toISOString();
  await ddb.send(
    new PutCommand({
      TableName: PLAYLIST_ITEMS_TABLE_NAME,
      Item: { playlistId, position, mediaId, addedAt: now },
    })
  );

  return jsonResponse(201, { playlistId, position, mediaId, addedAt: now });
}

async function removePlaylistItem(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  owner: boolean,
  userId: string
): Promise<APIGatewayProxyStructuredResultV2> {
  const playlistId = event.pathParameters?.playlistId;
  const positionParam = event.pathParameters?.position;
  if (!playlistId || positionParam === undefined) {
    return jsonResponse(400, { error: "playlistId and position are required" });
  }
  const position = Number(positionParam);
  if (!Number.isInteger(position)) return jsonResponse(400, { error: "position must be an integer" });

  const loaded = await loadPlaylist(playlistId, owner, userId);
  if ("deny" in loaded) return denyResponse(loaded.deny);

  try {
    await ddb.send(
      new DeleteCommand({
        TableName: PLAYLIST_ITEMS_TABLE_NAME,
        Key: { playlistId, position },
        ConditionExpression: "attribute_exists(playlistId)",
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return jsonResponse(404, { error: "Item not found" });
    throw err;
  }

  await ddb.send(
    new UpdateCommand({
      TableName: PLAYLISTS_TABLE_NAME,
      Key: { playlistId },
      UpdateExpression: "ADD itemCount :minusOne SET updatedAt = :now",
      ExpressionAttributeValues: { ":minusOne": -1, ":now": new Date().toISOString() },
    })
  );

  return jsonResponse(200, { playlistId, position, deleted: true });
}

/**
 * position is the DynamoDB sort key, so an item's identity is
 * {playlistId, position} — it can't be changed via UpdateItem. Reordering
 * swaps content (mediaId/addedAt) between the two adjacent position slots
 * instead of renumbering, so position values never move.
 */
async function moveItem(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  owner: boolean,
  userId: string
): Promise<APIGatewayProxyStructuredResultV2> {
  const playlistId = event.pathParameters?.playlistId;
  const positionParam = event.pathParameters?.position;
  if (!playlistId || positionParam === undefined) {
    return jsonResponse(400, { error: "playlistId and position are required" });
  }
  const position = Number(positionParam);
  if (!Number.isInteger(position)) return jsonResponse(400, { error: "position must be an integer" });

  const loaded = await loadPlaylist(playlistId, owner, userId);
  if ("deny" in loaded) return denyResponse(loaded.deny);

  let payload: { direction?: string };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }
  const direction = payload.direction;
  if (direction !== "up" && direction !== "down") {
    return jsonResponse(400, { error: 'direction must be "up" or "down"' });
  }

  const result = await ddb.send(
    new QueryCommand({
      TableName: PLAYLIST_ITEMS_TABLE_NAME,
      KeyConditionExpression: "playlistId = :p",
      ExpressionAttributeValues: { ":p": playlistId },
    })
  );
  const items = (result.Items ?? []) as { position: number; mediaId: string; addedAt: string }[];
  const idx = items.findIndex((i) => i.position === position);
  if (idx === -1) return jsonResponse(404, { error: "Item not found" });

  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= items.length) {
    return jsonResponse(400, { error: `Already at the ${direction === "up" ? "top" : "bottom"}` });
  }

  const a = items[idx];
  const b = items[swapIdx];
  await Promise.all([
    ddb.send(
      new PutCommand({ TableName: PLAYLIST_ITEMS_TABLE_NAME, Item: { playlistId, position: a.position, mediaId: b.mediaId, addedAt: b.addedAt } })
    ),
    ddb.send(
      new PutCommand({ TableName: PLAYLIST_ITEMS_TABLE_NAME, Item: { playlistId, position: b.position, mediaId: a.mediaId, addedAt: a.addedAt } })
    ),
  ]);

  return jsonResponse(200, { swapped: [a.position, b.position] });
}

async function resolveEmails(userIds: string[]): Promise<Map<string, string>> {
  const uniqueUserIds = [...new Set(userIds)];
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
  return new Map(entries.filter((e): e is [string, string] => e[1] !== undefined));
}
