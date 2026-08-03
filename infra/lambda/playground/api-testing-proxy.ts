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
}

interface ProviderDef {
  baseUrl: string;
  /** SSM SecureString parameter holding the real key — undefined means no auth needed (e.g. UK Police). */
  ssmParameterName?: string;
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

function buildUrl(provider: ProviderDef, endpoint: EndpointDef, params: Record<string, string>, secret?: string) {
  const usedKeys = new Set<string>();
  const path = endpoint.pathTemplate.replace(/:(\w+)/g, (_match, name: string) => {
    usedKeys.add(name);
    return encodeURIComponent(params[name] ?? "");
  });

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!usedKeys.has(key)) query.set(key, value);
  }
  if (endpoint.secretQueryParam && secret) query.set(endpoint.secretQueryParam, secret);

  const qs = query.toString();
  return `${provider.baseUrl}${path}${qs ? `?${qs}` : ""}`;
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
    const url = buildUrl(provider, endpoint, params, secret);

    const upstream = await fetch(url, { headers: { Accept: "application/json" } });
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
