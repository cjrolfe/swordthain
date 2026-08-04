# Swordthain Playground — Backlog

Deferred work, parked API integrations, and owner action items. Not a roadmap — just a place to look before assuming something is unbuilt or forgotten.

## Undocumented existing features

Built but not yet reflected in `README.md`/`CLAUDE.md`:

- Root hub `index.html`.
- The `/demos/` subfolder reorganization (company demo sites moved under `demos/`).
- The API-testing playground itself (Weather, Police, Ticketmaster, Vehicle APIs pages) — worth at least a one-paragraph mention of what it's for and the SSM-secret pattern it uses (`/swordthain/api-testing/{provider}-api-key`, populated out-of-band via `aws ssm put-parameter`, never committed to git).

## API integrations — status

- **Ticketmaster** — done, working. Consumer Key stored in SSM, verified live against Discovery API v2. (Consumer Secret deliberately not stored — only the Discovery API's `apikey` query param is needed; the secret is for OAuth flows on other Ticketmaster products this doesn't use.)
- **VES (vehicle enquiry)** — production key works, verified live. UAT sandbox key is dead/expired. Parked — chase a fresh DVLA UAT credential only if sandbox testing is actually needed again. Now shares the "Vehicle APIs" page with MOT History (`api-testing/vehicle-apis/`).
- **MOT History (DVSA)** — done, working. First provider needing OAuth2 client-credentials auth (Client ID/Secret → bearer token) plus a separate API key, rather than one static secret — required extending `api-testing-proxy.ts`'s provider schema (`oauth2`/`ssmHeaderParameters`/`staticHeaders` on `ProviderDef`, a token-fetch-and-cache helper, retry-once-on-401). Verified live against a real registration with real DVSA test history returned.
- **TfL** — deferred; ~79 endpoints, but the integration pattern proven by Ticketmaster/Weather/Police should transfer directly.
- **Animal Shelter** (What3Words + ChipNDoodle) — deferred; needs splitting into two separate API-testing entries since it's really two unrelated providers bundled under one idea.
- **Charity Commission** — skipped entirely, pending real connection details from the owner.

## Owner action items

- **Apple TV "Option A" test** (`docs/apple-tv-discovery.md`) — AirPlay a video from the media-app Lightbox to a real Apple TV and judge whether that alone is good enough, before considering a native/companion-app approach. Needs a real device — not something Claude can do.
