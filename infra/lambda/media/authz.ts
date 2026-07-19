import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

/**
 * Cognito's `cognito:groups` claim comes through API Gateway v2's JWT
 * authorizer as a real string array (confirmed against the deployed API,
 * not just the type declarations) — the string/CSV branches below are a
 * defensive fallback only, not the expected path.
 */
export function isOwner(claims: APIGatewayProxyEventV2WithJWTAuthorizer["requestContext"]["authorizer"]["jwt"]["claims"]): boolean {
  const groups = claims["cognito:groups"];
  if (Array.isArray(groups)) return groups.includes("Owner");
  if (typeof groups === "string") {
    try {
      const parsed = JSON.parse(groups);
      if (Array.isArray(parsed)) return parsed.includes("Owner");
    } catch {
      // Not JSON — fall through to a plain comma-split check below.
    }
    return groups.split(",").map((g) => g.trim()).includes("Owner");
  }
  return false;
}
