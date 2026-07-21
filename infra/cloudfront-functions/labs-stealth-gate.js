// Stealth-only 404 gate for labs.swordthain.com (apps/playground). This is
// NOT the real access boundary — it just keeps the URL from looking "alive"
// to anyone who isn't already signed in. Real authorization happens at the
// Cognito-verified API layer (see the REST API authorizer retrofit in
// infra/lib/playground-stack.ts); this function only decides whether to
// serve the static site at all.
//
// CloudFront Functions run in a restricted JS runtime with no crypto or
// network access, so this deliberately does NOT verify the JWT's signature
// — it just checks that a plausibly-shaped, unexpired, Owner-group token is
// present. A forged cookie could pass this gate, but every real API call
// behind it still requires a signature-verified Cognito token.
//
// cognito:groups here is a genuine JSON array (e.g. ["Owner"]) because this
// decodes the raw ID token straight from the cookie — unlike API Gateway's
// HTTP API JWT authorizer, which flattens it into a bracket-wrapped string
// ("[Owner]") when passing claims to Lambda. Confirmed against a real token
// during this phase, not assumed from the earlier authorizer-specific bug.
//
// Uses the runtime's built-in atob rather than a hand-rolled base64 decode
// loop — a manual char-by-char loop over a ~700-character JWT payload blew
// CloudFront Functions' instruction budget (confirmed empirically via
// `aws cloudfront test-function`: "RangeError: Instruction limit exceeded"
// at ~50-60% utilization even with a precomputed lookup table instead of
// indexOf). atob covers the same ~14% of budget instead.
//
// Padding back to a multiple of 4 is required: JWTs strip base64url padding
// (RFC 7515), but atob() throws "Unexpected end of input" without it — and
// only for payload lengths that land on certain remainders mod 4, which is
// exactly why this passed testing initially (those tokens' payload lengths
// happened not to trigger it) and then failed for real once cutover
// verification produced a token with a different-length payload.
function decodeBase64Url(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return atob(str);
}

function notFound() {
  return {
    statusCode: 404,
    statusDescription: "Not Found",
    headers: {
      "content-type": { value: "text/html; charset=utf-8" },
      "cache-control": { value: "no-store" },
    },
    body: {
      encoding: "text",
      data: "<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>Not Found</h1></body></html>",
    },
  };
}

function handler(event) {
  var request = event.request;
  var cookies = request.cookies || {};
  var sessionCookie = cookies["swordthain_session"];
  if (!sessionCookie || !sessionCookie.value) {
    return notFound();
  }

  var parts = sessionCookie.value.split(".");
  if (parts.length !== 3) {
    return notFound();
  }

  var claims;
  try {
    claims = JSON.parse(decodeBase64Url(parts[1]));
  } catch (e) {
    return notFound();
  }

  var now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now) {
    return notFound();
  }

  var groups = claims["cognito:groups"];
  if (!Array.isArray(groups) || groups.indexOf("Owner") === -1) {
    return notFound();
  }

  return request;
}
