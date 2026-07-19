import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

/**
 * Cognito's `cognito:groups` claim comes through API Gateway v2's JWT
 * authorizer as a bracket-wrapped, comma-separated STRING — e.g.
 * `"[Owner]"` or `"[Owner, Member]"` — not a real JSON array and not
 * valid JSON at all (unquoted items), despite the `@types/aws-lambda`
 * claims type allowing `string[]`. Confirmed by logging the real claims
 * object from a live browser-authenticated request; an array-typed
 * assumption tested only against a hand-crafted Lambda invoke payload
 * had passed review here once already and was wrong.
 */
export function isOwner(claims: APIGatewayProxyEventV2WithJWTAuthorizer["requestContext"]["authorizer"]["jwt"]["claims"]): boolean {
  const groups = claims["cognito:groups"];
  if (Array.isArray(groups)) return groups.includes("Owner");
  if (typeof groups === "string") {
    return groups
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(",")
      .map((g) => g.trim())
      .includes("Owner");
  }
  return false;
}
