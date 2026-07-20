import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

/**
 * Every JSON response from the media API — baseline hardening headers on
 * top of the JSON body. There are no public/unauthenticated routes (every
 * route sits behind the Cognito JWT authorizer), but these cost nothing
 * and cover the "robots/no-index headers" + "HSTS enabled" hardening
 * requirements without needing a CDN layer in front of the API.
 */
export const jsonResponse = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "x-robots-tag": "noindex, nofollow",
    "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
    "x-content-type-options": "nosniff",
    // Responses carry presigned URLs and permission/activity data — never cache.
    "cache-control": "no-store",
  },
  body: JSON.stringify(body),
});
