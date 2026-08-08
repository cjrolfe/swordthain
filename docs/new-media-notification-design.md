# New-media-shared email notification — design

Status: implemented, built exactly as designed below.

## What this is

When the Owner shares a folder (or several) with an invitee, give the Owner the option to send that invitee an email letting them know there's new media to see, rather than the invitee having no idea until they happen to sign in and look.

## Confirmed product decisions

1. **Manual trigger** — no auto-send on grant. Owner grants folders normally, then explicitly clicks "Notify" once, covering everything granted in that sitting.
2. **Session-only tracking** — which shares haven't been emailed about yet lives in React state only, not the database. Lost on refresh; that's an accepted trade-off, not a bug.
3. **New shares only** — a permission upgrade on an already-shared folder never offers this option, only genuinely new grants.
4. **Optional personal note** — same UX as the existing invite email's optional message field.

## Architecture

- **New route on the existing `SharesFn`** (`infra/lambda/media/shares.ts`), not a new Lambda: `POST /admin/notify-shares`, body `{email, folderIds: string[], message?: string}`. `SharesFn` already has read access to both `FoldersTable` and `FolderSharesTable` (what this needs); the only gap is SES access, which is additive — mirrors `InvitesFn`'s existing `ses:SendEmail` grant pattern exactly (`infra/lambda/media/invites.ts`'s `SESv2Client({region: "us-east-1"})` + `SendEmailCommand` usage and its `escapeHtml()` helper — reuse, don't duplicate differently).
- **Server-side validation, not client trust**: before revealing any folder title in an email, the Lambda re-checks each `folderId` against a real, current `FolderSharesTable` record for that `email` (a `GetCommand` per folderId, keyed on the table's actual `{folderId, userId}` primary key). Partial acceptance: reject only if *zero* folderIds validate; otherwise notify about the valid subset and report `invalidFolderIds` back so the frontend can react.
- **CDK** (`infra/lib/media-app-data-stack.ts`, `sharesFn` block): add `SES_FROM_ADDRESS`/`SITE_URL` env vars + `ses:SendEmail` IAM grant (both already exist as stack props, already consumed by `invitesFn` in the same file — zero new prop plumbing), bump timeout 10s→15s to match `InvitesFn`, and wire the new route onto the same existing `sharesIntegration` already reused by the two current `SharesFn` routes.
- **Frontend** (`apps/media-app/src/components/PermissionsMatrix.tsx`): new `pendingNotify: Record<userId, folderId[]>` state (keyed by friend so switching friends doesn't lose a pending batch), populated by a one-line addition inside `handleAdd()`'s success path only (never on a failed/no-op grant). A dismissible banner ("N new folders granted this session — Notify [email] / Dismiss") appears when the selected friend has a pending batch, opening a small dialog with an optional note textarea and Send/Cancel, following the existing `busy`/`error` state conventions already used throughout this component.
- **New `api.ts` method**: `notifyShares({email, folderIds, message?})`.

### Request/response contract

```
POST /admin/notify-shares
{
  "email": "friend@example.com",
  "folderIds": ["folder-abc", "folder-def"],
  "message": "Here's the beach trip footage!"   // optional
}
```

Response (200):
```json
{
  "email": "friend@example.com",
  "notifiedFolderIds": ["folder-abc", "folder-def"],
  "invalidFolderIds": []
}
```

Errors: `400` missing/malformed `email`/`folderIds`, or zero folderIds validated; `403` not Owner; `404` `email` has no Cognito account.

### Validation logic

```ts
async function notifyShares(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  let payload: { email?: string; folderIds?: string[]; message?: string };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { email, folderIds, message } = payload;
  if (!email) return jsonResponse(400, { error: "email is required" });
  if (!Array.isArray(folderIds) || folderIds.length === 0) {
    return jsonResponse(400, { error: "folderIds must be a non-empty array" });
  }
  if (folderIds.length > 50) {
    return jsonResponse(400, { error: "Too many folderIds in one request" });
  }

  // Resolve the invitee to their Cognito sub the same way grant does — the
  // FolderSharesTable sort key is userId, not email.
  const userId = await subForEmail(email);
  if (!userId) return jsonResponse(404, { error: `No account found for ${email}` });

  // Validate each folderId against a REAL, CURRENT share record — never
  // trust the client's claim. Run in parallel.
  const results = await Promise.all(
    folderIds.map(async (folderId) => {
      const share = await ddb.send(
        new GetCommand({ TableName: FOLDER_SHARES_TABLE_NAME, Key: { folderId, userId } })
      );
      return { folderId, share: share.Item };
    })
  );

  const valid = results.filter((r) => r.share);
  const invalidFolderIds = results.filter((r) => !r.share).map((r) => r.folderId);

  if (valid.length === 0) {
    return jsonResponse(400, {
      error: "None of the provided folderIds have a current share for this email",
      invalidFolderIds,
    });
  }

  const folders = await Promise.all(
    valid.map((r) => ddb.send(new GetCommand({ TableName: FOLDERS_TABLE_NAME, Key: { folderId: r.folderId } })))
  );
  const folderTitles = folders.map((f) => f.Item?.title).filter((t): t is string => !!t);

  if (folderTitles.length === 0) {
    return jsonResponse(404, { error: "Shared folders no longer exist" });
  }

  await sendNewMediaEmail(email, folderTitles, message); // see buildNewMediaEmailHtml below

  return jsonResponse(200, {
    email,
    notifiedFolderIds: valid.map((r) => r.folderId),
    invalidFolderIds,
  });
}
```

**Why partial acceptance, not all-or-nothing:** reject only if *zero* folderIds validate (almost certainly a client bug or fully stale state); otherwise notify about the valid subset and report `invalidFolderIds` back. The client-side tracking state is inherently a best-effort cache (session-only) — by the time the Owner clicks Notify, a folder could plausibly have been revoked in another tab. Silently dropping a few stale entries while still emailing about the rest matches the "best effort, not a ledger" nature of this feature.

### CDK diff — `infra/lib/media-app-data-stack.ts`

In the `sharesFn` block:
```diff
     const sharesFn = new NodejsFunction(this, "SharesFn", {
       runtime: lambda.Runtime.NODEJS_20_X,
       entry: path.join(lambdaDir, "shares.ts"),
-      timeout: Duration.seconds(10),
+      timeout: Duration.seconds(15),   // match InvitesFn — SES send adds latency
       memorySize: 256,
       environment: {
         FOLDERS_TABLE_NAME: this.foldersTable.tableName,
         FOLDER_SHARES_TABLE_NAME: this.folderSharesTable.tableName,
         USER_POOL_ID: props.userPoolId,
+        SES_FROM_ADDRESS: props.sesFromAddress,
+        SITE_URL: props.siteUrl,
       },
       bundling: { externalModules: [] },
     });
     this.foldersTable.grantReadData(sharesFn);
     this.folderSharesTable.grantReadWriteData(sharesFn);
     sharesFn.addToRolePolicy(
       new iam.PolicyStatement({
         actions: ["cognito-idp:AdminGetUser", "cognito-idp:ListUsersInGroup"],
         resources: [props.userPoolArn],
       })
     );
+    sharesFn.addToRolePolicy(
+      new iam.PolicyStatement({
+        actions: ["ses:SendEmail"],
+        resources: [props.sesIdentityArn],
+      })
+    );
```

API Gateway route wiring: add a third `httpApi.addRoutes({...})` call reusing the same `sharesIntegration` already declared and reused across the two existing `SharesFn` routes (`/folders/{folderId}/shares`, `/admin/permissions-matrix`) — `path: "/admin/notify-shares"`, `methods: [apigwv2.HttpMethod.POST]`, same integration, same authorizer.

### Frontend — `PermissionsMatrix.tsx`

```ts
// Session-only (component state, not persisted): folderIds granted to a
// friend during this browser session that haven't been emailed about yet.
// Keyed by friend.userId so navigating between friends in the left pane
// doesn't lose a pending notify batch for someone else. Lost on refresh —
// that's deliberate (session-only tracking), not a bug to fix.
const [pendingNotify, setPendingNotify] = useState<Record<string, string[]>>({});
const [notifyOpen, setNotifyOpen] = useState(false);
const [notifyNote, setNotifyNote] = useState("");
const [notifyBusy, setNotifyBusy] = useState(false);
```

`handleAdd()` — one-line addition, success path only:
```diff
   async function handleAdd() {
     if (!selectedFriend || !addFolderId) return;
     setBusy(true);
     try {
       await api.updateShare(addFolderId, { action: "grant", email: selectedFriend.email, permission: addPermission });
+      setPendingNotify((prev) => ({
+        ...prev,
+        [selectedFriend.userId]: [...(prev[selectedFriend.userId] ?? []), addFolderId],
+      }));
       setAddFolderId("");
       setAddPermission("view");
       await load();
     } catch (err) {
       setError(err instanceof Error ? err.message : "Failed to add access");
     } finally {
       setBusy(false);
     }
   }
```
This only fires for `handleAdd()` (grant a folder not previously shared, chosen from `availableFolders`). `handleChangePermission()` is deliberately untouched — it only ever operates on folders already in `grants`, never `availableFolders`, so decision #3 (new shares only) falls out for free.

```tsx
async function handleSendNotify() {
  if (!selectedFriend) return;
  const folderIds = pendingNotify[selectedFriend.userId] ?? [];
  if (folderIds.length === 0) return;
  setNotifyBusy(true);
  try {
    await api.notifyShares({ email: selectedFriend.email, folderIds, message: notifyNote || undefined });
    setPendingNotify((prev) => {
      const { [selectedFriend.userId]: _, ...rest } = prev;
      return rest;
    });
    setNotifyOpen(false);
    setNotifyNote("");
  } catch (err) {
    // Preserve pendingNotify on failure so the Owner can retry.
    setError(err instanceof Error ? err.message : "Failed to send notification");
  } finally {
    setNotifyBusy(false);
  }
}
```

UI: a dismissible banner ("N new folders granted this session — Notify [email] / Dismiss") when the selected friend has a pending batch, positioned above the existing add-grant form; clicking Notify opens a small dialog with an optional note textarea and Send/Cancel.

### New `api.ts` method

```ts
notifyShares: (body: { email: string; folderIds: string[]; message?: string }) =>
  request<{ email: string; notifiedFolderIds: string[]; invalidFolderIds: string[] }>(
    "POST",
    "/admin/notify-shares",
    body
  ),
```

### Edge cases

| Case | Resolution |
|---|---|
| Owner refreshes/navigates away before clicking Notify | Tracking state lost — deliberate (session-only tracking), not a bug. |
| Grant fails (duplicate/no-op re-grant) | Never enters tracking state — `setPendingNotify` sits after the successful `await`, inside `try`. Also structurally unreachable: `addFolderId` only offers `availableFolders` (not-yet-shared folders). |
| Owner grants the same folder twice in one session | Not reachable through the UI (see above). If ever fed from another path, dedupe defensively with a `Set`. |
| SES send fails / `api.notifyShares` throws | `pendingNotify` preserved (only cleared on success) so the Owner can retry via the same banner. |
| Some `folderIds` fail Lambda-side validation (stale/revoked between grant and notify click) | Lambda notifies the valid subset, reports `invalidFolderIds`; frontend treats any 2xx as done and clears the whole pending set — the stale ones were correctly excluded. |
| All `folderIds` fail validation | Lambda returns 400; frontend surfaces via existing `error` state, leaves `pendingNotify` untouched. |

## Email template

Mirrors `invites.ts`'s `buildInviteEmailHtml()` exactly in structure/styling — same 560px dark card, film-strip header image, Georgia serif "Swordthain" wordmark, `#4a7dff` blue accent, same `escapeHtml()` reuse for all user-controlled strings (email, folder titles, personal note).

**Subject:** `New media shared with you on Swordthain`

**Plain text body:**
```
New media has been shared with you on Swordthain.

The following folder(s) are now available for you to view:
- {folder title 1}
- {folder title 2}

[personal note, if provided, inserted here as its own paragraph]

Go to {SITE_URL} to take a look.
```

**HTML body** (`buildNewMediaEmailHtml(email, folderTitles, personalMessage)`):
```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b0f12;">
  <tr>
    <td align="center" style="padding:28px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;">
        <tr>
          <td>
            <img src="${FILM_STRIP_IMAGE_URL}" width="560" alt="" style="display:block;width:100%;max-width:560px;height:auto;border:0;" />
          </td>
        </tr>
        <tr>
          <td style="background:#1c1d1f;padding:40px 36px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:Georgia,'Times New Roman',serif;font-size:32px;line-height:1.2;color:#f5f2ea;letter-spacing:0.01em;padding:0 0 6px;">
                  Swordthain
                </td>
              </tr>
              <tr>
                <td style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;color:#a9a59c;padding:0 0 28px;">
                  Family movies, straight from the vault.
                </td>
              </tr>
              <tr>
                <td style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#f0ece4;padding:0 0 20px;">
                  New media has been shared with you on Swordthain.
                </td>
              </tr>
              <tr>
                <td style="padding:0 0 24px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    ${folderTitles.map(title => `
                    <tr>
                      <td style="padding:0 0 10px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td width="8" valign="middle" style="padding:0 12px 0 2px;">
                              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                                <tr><td width="6" height="6" style="background:#4a7dff;border-radius:3px;font-size:0;line-height:0;">&nbsp;</td></tr>
                              </table>
                            </td>
                            <td valign="middle" style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#f0ece4;">
                              ${escapeHtml(title)}
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>`).join("")}
                  </table>
                </td>
              </tr>
              ${personalMessage ? `
              <tr>
                <td style="padding:0 0 24px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background:rgba(255,255,255,0.04);border-left:3px solid #4a7dff;padding:14px 18px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-style:italic;line-height:1.55;color:#d8d4ca;">
                        "${escapeHtml(personalMessage)}"
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>` : ""}
              <tr>
                <td style="padding:4px 0 4px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background:#4a7dff;border-radius:8px;">
                        <a href="${SITE_URL}" style="display:inline-block;padding:14px 34px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">Open Swordthain</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 20px 4px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#5f5e5a;text-align:center;">
            This was sent to ${escapeHtml(email)} because folders were shared with your account. If you weren't expecting this, contact whoever shared it with you.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

**Deliberate deviations from the invite email** (worth recording so a future implementer doesn't "fix" them by accident): no numbered "getting started" steps (the recipient already has an account and knows how to sign in) and no "Watching on the TV?" callout (that's first-time-onboarding messaging) — this email is shorter and more direct than the invite email by design, since its audience is already onboarded.
