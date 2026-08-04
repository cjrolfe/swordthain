import type { APIGatewayProxyEvent, APIGatewayProxyHandler } from "aws-lambda";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { isOwner } from "../media/authz";

const ssm = new SSMClient({});

// Cached across warm invocations, keyed by SSM parameter name — avoids an
// SSM call on every request.
const secretCache = new Map<string, string>();

async function getSecret(parameterName: string): Promise<string> {
  const cached = secretCache.get(parameterName);
  if (cached) return cached;
  const result = await ssm.send(new GetParameterCommand({ Name: parameterName, WithDecryption: true }));
  const value = result.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${parameterName} has no value`);
  secretCache.set(parameterName, value);
  return value;
}

interface EndpointDef {
  pathTemplate: string;
  /** Query param name the secret is injected under, e.g. "key" or "apikey". Omit if the endpoint needs no secret. */
  secretQueryParam?: string;
  /** Header name the secret is injected under, e.g. "x-api-key" — alternative to secretQueryParam. */
  secretHeaderName?: string;
  /** When true, non-path params are JSON-encoded into a POST body instead of appended as a query string. */
  hasJsonBody?: boolean;
}

/** OAuth2 client-credentials config for providers whose auth is a bearer
 * token instead of (or in addition to) a static secret — e.g. MOT History,
 * which exchanges a Client ID + Secret for a short-lived token at a
 * Microsoft identity platform endpoint. */
interface OAuth2ClientCredentialsConfig {
  tokenUrl: string;
  scope: string;
  ssmClientIdParameterName: string;
  ssmClientSecretParameterName: string;
}

interface ProviderDef {
  baseUrl: string;
  /** SSM SecureString parameter holding the real key — undefined means no auth needed (e.g. UK Police). */
  ssmParameterName?: string;
  /** Enables an OAuth2 client-credentials bearer token, sent as `Authorization: Bearer <token>`. */
  oauth2?: OAuth2ClientCredentialsConfig;
  /** SSM SecureString params injected as static request headers, keyed by header name — for
   * secrets that aren't the OAuth2 token itself (e.g. a required API key sent alongside it). */
  ssmHeaderParameters?: Record<string, string>;
  /** Fixed, non-secret headers sent on every request to this provider. */
  staticHeaders?: Record<string, string>;
  endpoints: Record<string, EndpointDef>;
}

/**
 * Fixed, hardcoded allowlist of exactly what this proxy will call — the
 * client only ever sends {provider, endpointId, params}, never a URL. This
 * is a deliberate security choice: an open "proxy anything the client asks
 * for" design would effectively be an SSRF endpoint even behind Owner-only
 * auth, so every reachable target is enumerated here at deploy time.
 */
const PROVIDERS: Record<string, ProviderDef> = {
  weather: {
    baseUrl: "https://api.weatherapi.com",
    ssmParameterName: "/swordthain/api-testing/weather-api-key",
    endpoints: {
      "weather-api": { pathTemplate: "/v1/current.json", secretQueryParam: "key" },
    },
  },
  police: {
    baseUrl: "https://data.police.uk/api",
    endpoints: {
      "availability-crimes-street-dates": { pathTemplate: "/crimes-street-dates" },
      "list-forces": { pathTemplate: "/forces" },
      "specific-force": { pathTemplate: "/forces/:force" },
      "force-senior-officers": { pathTemplate: "/forces/:force/people" },
      "street-level-crimes-point": { pathTemplate: "/crimes-street/:crimeCategory" },
      "street-level-crimes-custom-area-via-poly": { pathTemplate: "/crimes-street/:crimeCategory" },
      "street-level-outcomes-location-id": { pathTemplate: "/outcomes-at-location" },
      "street-level-outcomes-lat-lng": { pathTemplate: "/outcomes-at-location" },
      "street-level-outcomes-poly": { pathTemplate: "/outcomes-at-location" },
      "crimes-at-a-location-location-id": { pathTemplate: "/crimes-at-location" },
      "crimes-at-a-location-lat-lng": { pathTemplate: "/crimes-at-location" },
      "crimes-with-no-location": { pathTemplate: "/crimes-no-location" },
      "crime-categories": { pathTemplate: "/crime-categories" },
      "crime-last-updated": { pathTemplate: "/crime-last-updated" },
      "outcomes-for-a-specific-crime-persistent-id": { pathTemplate: "/outcomes-for-crime/:crimePersistentId" },
      "list-neighbourhoods-for-a-force": { pathTemplate: "/:force/neighbourhoods" },
      "specific-neighbourhood": { pathTemplate: "/:force/:neighbourhood" },
      "neighbourhood-boundary": { pathTemplate: "/:force/:neighbourhood/boundary" },
      "neighbourhood-team": { pathTemplate: "/:force/:neighbourhood/people" },
      "neighbourhood-events": { pathTemplate: "/:force/:neighbourhood/events" },
      "neighbourhood-priorities": { pathTemplate: "/:force/:neighbourhood/priorities" },
      "locate-neighbourhood": { pathTemplate: "/locate-neighbourhood" },
      "stops-by-area-point": { pathTemplate: "/stops-street" },
      "stops-by-area-poly": { pathTemplate: "/stops-street" },
      "stops-at-location": { pathTemplate: "/stops-at-location" },
      "stops-with-no-location": { pathTemplate: "/stops-no-location" },
      "stops-by-force": { pathTemplate: "/stops-force" },
    },
  },
  ticketmaster: {
    baseUrl: "https://app.ticketmaster.com/discovery/v2",
    ssmParameterName: "/swordthain/api-testing/ticketmaster-api-key",
    endpoints: {
      "search-events": { pathTemplate: "/events.json", secretQueryParam: "apikey" },
      "get-event-details": { pathTemplate: "/events/:eventId.json", secretQueryParam: "apikey" },
      "get-event-images": { pathTemplate: "/events/:eventId/images.json", secretQueryParam: "apikey" },
      "search-attractions": { pathTemplate: "/attractions.json", secretQueryParam: "apikey" },
      "get-attraction-details": { pathTemplate: "/attractions/:attractionId.json", secretQueryParam: "apikey" },
      "search-venues": { pathTemplate: "/venues.json", secretQueryParam: "apikey" },
      "get-venue-details": { pathTemplate: "/venues/:venueId.json", secretQueryParam: "apikey" },
      "search-classifications": { pathTemplate: "/classifications.json", secretQueryParam: "apikey" },
      "get-classification-details": {
        pathTemplate: "/classifications/:classificationId.json",
        secretQueryParam: "apikey",
      },
      "get-segment-details": { pathTemplate: "/classifications/segments/:segmentId.json", secretQueryParam: "apikey" },
      "get-genre-details": { pathTemplate: "/classifications/genres/:genreId.json", secretQueryParam: "apikey" },
      "get-sub-genre-details": {
        pathTemplate: "/classifications/subgenres/:subGenreId.json",
        secretQueryParam: "apikey",
      },
      "find-suggest": { pathTemplate: "/suggest.json", secretQueryParam: "apikey" },
    },
  },
  "ves-uat": {
    baseUrl: "https://uat.driver-vehicle-licensing.api.gov.uk",
    ssmParameterName: "/swordthain/api-testing/ves-uat-api-key",
    endpoints: {
      "vehicle-details": {
        pathTemplate: "/vehicle-enquiry/v1/vehicles",
        secretHeaderName: "x-api-key",
        hasJsonBody: true,
      },
    },
  },
  "ves-production": {
    baseUrl: "https://driver-vehicle-licensing.api.gov.uk",
    ssmParameterName: "/swordthain/api-testing/ves-production-api-key",
    endpoints: {
      "vehicle-details": {
        pathTemplate: "/vehicle-enquiry/v1/vehicles",
        secretHeaderName: "x-api-key",
        hasJsonBody: true,
      },
    },
  },
  "mot-history": {
    // Best-available base URL/path — DVSA's live spec page didn't yield
    // exact details via fetch. If the first real call 404s on the path
    // itself (not an auth error), fix pathTemplate here from the real
    // response rather than guessing further.
    baseUrl: "https://history.mot.api.gov.uk",
    oauth2: {
      tokenUrl: "https://login.microsoftonline.com/a455b827-244f-4c97-b5b4-ce5d13b4d00c/oauth2/v2.0/token",
      scope: "https://tapi.dvsa.gov.uk/.default",
      ssmClientIdParameterName: "/swordthain/api-testing/mot-history-client-id",
      ssmClientSecretParameterName: "/swordthain/api-testing/mot-history-client-secret",
    },
    ssmHeaderParameters: {
      "X-API-Key": "/swordthain/api-testing/mot-history-api-key",
    },
    endpoints: {
      "mot-history-lookup": { pathTemplate: "/v1/trade/vehicles/registration/:registration" },
    },
  },
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json",
};

const jsonResponse = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify(body),
});

function buildPath(pathTemplate: string, params: Record<string, string>) {
  const usedKeys = new Set<string>();
  const path = pathTemplate.replace(/:(\w+)/g, (_match, name: string) => {
    usedKeys.add(name);
    return encodeURIComponent(params[name] ?? "");
  });
  return { path, usedKeys };
}

function buildRequest(
  provider: ProviderDef,
  endpoint: EndpointDef,
  params: Record<string, string>,
  secret?: string,
  extraHeaders: Record<string, string> = {}
): { url: string; init: RequestInit } {
  const { path, usedKeys } = buildPath(endpoint.pathTemplate, params);
  const remaining: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!usedKeys.has(key)) remaining[key] = value;
  }

  const headers: Record<string, string> = { Accept: "application/json", ...extraHeaders };
  if (endpoint.secretHeaderName && secret) headers[endpoint.secretHeaderName] = secret;

  if (endpoint.hasJsonBody) {
    headers["Content-Type"] = "application/json";
    return { url: `${provider.baseUrl}${path}`, init: { method: "POST", headers, body: JSON.stringify(remaining) } };
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(remaining)) query.set(key, value);
  if (endpoint.secretQueryParam && secret) query.set(endpoint.secretQueryParam, secret);
  const qs = query.toString();
  return { url: `${provider.baseUrl}${path}${qs ? `?${qs}` : ""}`, init: { headers } };
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

// Cached across warm invocations, keyed by the client-id SSM parameter name
// (unique per provider in practice). Refreshed this long before actual
// expiry so a token fetched near the end of its life never gets used
// mid-flight on the real request.
const tokenCache = new Map<string, CachedToken>();
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

async function getOAuth2Token(config: OAuth2ClientCredentialsConfig): Promise<string> {
  const cacheKey = config.ssmClientIdParameterName;
  const cached = tokenCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAtMs - TOKEN_EXPIRY_MARGIN_MS > now) return cached.accessToken;

  const [clientId, clientSecret] = await Promise.all([
    getSecret(config.ssmClientIdParameterName),
    getSecret(config.ssmClientSecretParameterName),
  ]);

  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: config.scope,
  });

  const tokenResponse = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  if (!tokenResponse.ok) {
    const detail = await tokenResponse.text().catch(() => "");
    throw new Error(`OAuth2 token request to ${config.tokenUrl} failed: ${tokenResponse.status} ${detail.slice(0, 500)}`);
  }

  const parsed = (await tokenResponse.json()) as { access_token?: string; expires_in?: number };
  if (!parsed.access_token) {
    throw new Error(`OAuth2 token response from ${config.tokenUrl} had no access_token`);
  }

  const expiresInMs = (parsed.expires_in ?? 3600) * 1000;
  const token: CachedToken = { accessToken: parsed.access_token, expiresAtMs: now + expiresInMs };
  tokenCache.set(cacheKey, token);
  return token.accessToken;
}

async function resolveProviderHeaders(provider: ProviderDef): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...provider.staticHeaders };

  if (provider.ssmHeaderParameters) {
    const entries = await Promise.all(
      Object.entries(provider.ssmHeaderParameters).map(
        async ([headerName, parameterName]) => [headerName, await getSecret(parameterName)] as const
      )
    );
    for (const [headerName, value] of entries) headers[headerName] = value;
  }

  if (provider.oauth2) {
    headers.Authorization = `Bearer ${await getOAuth2Token(provider.oauth2)}`;
  }

  return headers;
}

async function callUpstream(
  provider: ProviderDef,
  endpoint: EndpointDef,
  params: Record<string, string>,
  secret: string | undefined
): Promise<Response> {
  const extraHeaders = await resolveProviderHeaders(provider);
  const { url, init } = buildRequest(provider, endpoint, params, secret, extraHeaders);
  const upstream = await fetch(url, init);

  if (upstream.status === 401 && provider.oauth2) {
    // Cached-but-now-invalid token (clock skew, revocation, etc.) — drop it
    // and retry once with a freshly fetched one, so a stale cache doesn't
    // look identical to a real auth failure in this debugging tool.
    tokenCache.delete(provider.oauth2.ssmClientIdParameterName);
    const retryHeaders = await resolveProviderHeaders(provider);
    const retryReq = buildRequest(provider, endpoint, params, secret, retryHeaders);
    return fetch(retryReq.url, retryReq.init);
  }

  return upstream;
}

// REST API v1's COGNITO_USER_POOLS authorizer puts decoded claims at
// event.requestContext.authorizer.claims (no ".jwt" nesting, unlike the
// HTTP API v2 JWT authorizer isOwner() was originally written for) — but
// isOwner()'s bracket-stripping is a no-op on REST API v1's plain,
// unbracketed "cognito:groups" string, so the same function is safe to
// reuse here with a type-only cast.
export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent) => {
  const claims = (event.requestContext.authorizer as { claims?: Record<string, unknown> } | null)?.claims;
  if (!claims || !isOwner(claims as never)) {
    return jsonResponse(403, { error: "Owner access required" });
  }

  let body: { provider?: string; endpointId?: string; params?: Record<string, string> };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { provider: providerId, endpointId, params = {} } = body;
  const provider = providerId ? PROVIDERS[providerId] : undefined;
  if (!provider) return jsonResponse(400, { error: `Unknown provider: ${providerId}` });

  const endpoint = endpointId ? provider.endpoints[endpointId] : undefined;
  if (!endpoint) return jsonResponse(400, { error: `Unknown endpoint: ${endpointId}` });

  try {
    const secret = provider.ssmParameterName ? await getSecret(provider.ssmParameterName) : undefined;
    const upstream = await callUpstream(provider, endpoint, params, secret);
    const text = await upstream.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: "Upstream returned a non-JSON response", raw: text.slice(0, 2000) };
    }

    return jsonResponse(upstream.status, parsed);
  } catch (err) {
    return jsonResponse(502, { error: "Upstream request failed", detail: err instanceof Error ? err.message : String(err) });
  }
};
