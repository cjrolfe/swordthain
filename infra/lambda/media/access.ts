import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

export const ROOT = "ROOT";

export interface ResolvedAccess {
  /** The folder the explicit share was found on — may be an ancestor of the folder being checked. */
  sharedFolderId: string;
  permission: "view" | "download" | "upload" | string;
  grantedAt: string;
}

/**
 * Walks from `folderId` up through `parentFolderId` ancestors to ROOT,
 * returning the closest explicit FolderShares entry for `userId` — i.e. a
 * share on a parent folder implies access to everything beneath it, but a
 * more specific (closer) share on a descendant takes precedence over one
 * further up the tree.
 */
export async function resolveAccess(
  ddb: DynamoDBDocumentClient,
  foldersTableName: string,
  folderSharesTableName: string,
  folderId: string,
  userId: string
): Promise<ResolvedAccess | null> {
  let currentId: string | undefined = folderId;
  const visited = new Set<string>();

  while (currentId && currentId !== ROOT && !visited.has(currentId)) {
    visited.add(currentId);

    const share = await ddb.send(
      new GetCommand({ TableName: folderSharesTableName, Key: { folderId: currentId, userId } })
    );
    if (share.Item) {
      return {
        sharedFolderId: currentId,
        permission: share.Item.permission,
        grantedAt: share.Item.grantedAt,
      };
    }

    const folder = await ddb.send(new GetCommand({ TableName: foldersTableName, Key: { folderId: currentId } }));
    if (!folder.Item) break;
    currentId = folder.Item.parentFolderId;
  }

  return null;
}

// Higher tiers imply lower ones: granting "download" also allows viewing,
// granting "upload" also allows viewing and downloading. These aren't
// independent flags — each share is a single tier on this ladder.
const PERMISSION_RANK: Record<string, number> = { view: 1, download: 2, upload: 3 };

export function hasPermission(granted: string | undefined, required: keyof typeof PERMISSION_RANK): boolean {
  if (!granted) return false;
  return (PERMISSION_RANK[granted] ?? 0) >= PERMISSION_RANK[required];
}
