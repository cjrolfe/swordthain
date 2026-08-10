import { useEffect, useState } from "react";
import mermaid from "mermaid";

const DIAGRAMS = {
  overview: `
flowchart TB
  classDef edge fill:#6c5ce022,stroke:#6c5ce0,color:#6c5ce0,stroke-width:1.5px
  classDef auth fill:#d14d6822,stroke:#d14d68,color:#d14d68,stroke-width:1.5px
  classDef compute fill:#c6821a22,stroke:#c6821a,color:#c6821a,stroke-width:1.5px
  classDef data fill:#1e9a9222,stroke:#1e9a92,color:#1e9a92,stroke-width:1.5px
  classDef client fill:transparent,stroke:#5b6b7a,color:#5b6b7a,stroke-dasharray:3 3

  familyBrowser["Family member<br/>browser"]:::client
  ownerBrowser["Owner browser<br/>(stealth-gated)"]:::client
  cliTool["media-app-cli<br/>(Terminal)"]:::client
  ghIssues["GitHub Issue<br/>create/archive company"]:::client

  subgraph EDGE["Edge — us-east-1"]
    siteCf["CloudFront<br/>swordthain.com"]:::edge
    labsCf["CloudFront<br/>labs.swordthain.com"]:::edge
  end

  subgraph AUTH["Auth — SwordthainAuthStack, us-east-1"]
    cognito["Cognito User Pool<br/>Owner / Member groups"]:::auth
    ses["SES identity<br/>noreply@swordthain.com"]:::auth
  end

  subgraph APIS["APIs"]
    mediaApi["Media HTTP API<br/>eu-west-1"]:::compute
    pgApi["Playground REST API<br/>us-east-1"]:::compute
  end

  subgraph MEDIACOMPUTE["Media app compute — eu-west-1<br/>SwordthainMediaAppDataStack"]
    mediaLambdas["9 Lambda functions<br/>upload · thumbnail · folders · shares<br/>invites · access · activity · playlists · stats"]:::compute
  end

  subgraph MEDIADATA["Media app data — eu-west-1"]
    mediaBucket[("S3: media bucket")]:::data
    mediaTables[("DynamoDB: 6 tables")]:::data
  end

  subgraph PGCOMPUTE["Playground compute — us-east-1"]
    pgProxy["ApiTestingProxyFn"]:::compute
    pgAutomation["Automation Lambda (Python)<br/>create/archive company"]:::compute
  end

  subgraph PGDATA["Playground data"]
    pgBucket[("S3: demo-sites bucket")]:::data
  end

  familyBrowser --> siteCf --> mediaApi
  ownerBrowser --> labsCf --> pgApi
  cliTool --> mediaApi
  ghIssues --> pgAutomation

  familyBrowser -. sign in .-> cognito
  ownerBrowser -. sign in .-> cognito
  cliTool -. sign in .-> cognito
  mediaApi -. authorize .-> cognito
  pgApi -. authorize .-> cognito

  mediaApi --> mediaLambdas --> mediaBucket
  mediaLambdas --> mediaTables
  mediaLambdas -. email .-> ses

  pgApi --> pgProxy
  pgAutomation --> pgBucket
`,
  mediaFlow: `
flowchart LR
  classDef compute fill:#c6821a22,stroke:#c6821a,color:#c6821a,stroke-width:1.5px
  classDef data fill:#1e9a9222,stroke:#1e9a92,color:#1e9a92,stroke-width:1.5px
  classDef auth fill:#d14d6822,stroke:#d14d68,color:#d14d68,stroke-width:1.5px

  api["Media HTTP API"]:::compute

  upload["UploadUrlFn<br/>presign PUT / multipart"]:::compute
  thumb["ThumbnailFn<br/>Sharp + FFmpeg layers"]:::compute
  folders["FoldersFn"]:::compute
  shares["SharesFn"]:::compute
  invites["InvitesFn"]:::compute
  access["MediaAccessFn<br/>view/download URLs"]:::compute
  activity["ActivityFn"]:::compute
  playlists["PlaylistsFn"]:::compute
  stats["StatsFn"]:::compute

  mediaBucket[("media bucket<br/>private, presigned only")]:::data
  mediaItems[("MediaItems")]:::data
  foldersT[("Folders")]:::data
  sharesT[("FolderShares")]:::data
  activityT[("ActivityLog")]:::data
  playlistsT[("Playlists")]:::data
  playlistItemsT[("PlaylistItems")]:::data

  identity["Cognito Admin API<br/>+ SES SendEmail"]:::auth

  api -->|"POST /media/upload-url*"| upload
  api -->|"/folders*"| folders
  api -->|"/folders/{id}/shares<br/>/admin/permissions-matrix<br/>/admin/notify-shares"| shares
  api -->|"/admin/invites*"| invites
  api -->|"/media/{id}/view-url<br/>/media/{id}/download-url"| access
  api -->|"/admin/activity"| activity
  api -->|"/playlists*"| playlists
  api -->|"/admin/stats"| stats

  upload -->|PutObject| mediaBucket
  mediaBucket -. "ObjectCreated<br/>originals/*" .-> thumb
  thumb -->|write item| mediaItems
  thumb -->|read/write| mediaBucket

  folders --> foldersT
  folders --> sharesT
  folders --> mediaItems

  shares --> sharesT
  shares -.-> identity

  invites --> sharesT
  invites -.-> identity

  access --> mediaItems
  access -->|write| activityT
  access --> mediaBucket

  activity --> activityT

  playlists --> playlistsT
  playlists --> playlistItemsT
  playlists --> mediaItems

  stats -. "CloudWatch metrics<br/>SES quota" .-> identity
  stats -.->|DescribeTable x6| mediaItems
`,
  auth: `
sequenceDiagram
  participant U as Browser / CLI
  participant C as Cognito
  participant Cr as CreateAuthChallengeFn
  participant O as OTP table
  participant S as SES
  participant V as VerifyAuthChallengeResponseFn

  U->>C: InitiateAuth (CUSTOM_AUTH, email)
  C->>Cr: generate challenge
  Cr->>O: store hashed code + expiry
  Cr->>S: SendEmail (6-digit code)
  S-->>U: code delivered
  U->>C: RespondToAuthChallenge (code)
  C->>V: verify answer
  V->>O: check hash + expiry
  alt correct
    V->>C: pass
    C-->>U: access + id + refresh tokens
  else wrong or expired
    V->>C: fail
    C-->>U: new challenge, retry
  end
`,
  cicd: `
flowchart LR
  classDef ci fill:#4c8f5822,stroke:#4c8f58,color:#4c8f58,stroke-width:1.5px
  classDef compute fill:#c6821a22,stroke:#c6821a,color:#c6821a,stroke-width:1.5px

  gh["push to main"]:::ci
  oidc["GitHub OIDC<br/>Provider"]:::ci

  infraRole["InfraCiRole<br/>assumes CDK bootstrap roles"]:::ci
  mediaRole["MediaAppCiRole<br/>S3 + CloudFront invalidate"]:::ci
  pgRole["PlaygroundCiRole<br/>S3 + Lambda + CloudFront invalidate"]:::ci

  cdkStacks["5 CDK stacks<br/>us-east-1 + eu-west-1"]:::compute
  mediaSite["media-app site bucket<br/>+ CloudFront"]:::compute
  pgSite["playground site bucket<br/>+ automation Lambda<br/>+ CloudFront"]:::compute

  gh -->|"infra/**"| infraRole --> cdkStacks
  gh -->|"apps/media-app/**"| mediaRole --> mediaSite
  gh -->|"apps/playground/**"| pgRole --> pgSite
  oidc -. trust .-> infraRole
  oidc -. trust .-> mediaRole
  oidc -. trust .-> pgRole
`,
} as const;

type DiagramKey = keyof typeof DIAGRAMS;

function Diagram({ diagramKey, svg }: { diagramKey: DiagramKey; svg: string | null }) {
  if (!svg) return <p className="hint">Rendering…</p>;
  return <div className="diagram-frame" dangerouslySetInnerHTML={{ __html: svg }} data-diagram={diagramKey} />;
}

export function Architecture() {
  const [svgs, setSvgs] = useState<Partial<Record<DiagramKey, string>>>({});

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default",
      themeVariables: { fontFamily: "ui-monospace, SF Mono, Cascadia Code, Consolas, monospace" },
    });

    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        (Object.keys(DIAGRAMS) as DiagramKey[]).map(async (key) => {
          const { svg } = await mermaid.render(`arch-${key}`, DIAGRAMS[key]);
          return [key, svg] as const;
        })
      );
      if (!cancelled) setSvgs(Object.fromEntries(entries));
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h3>Infrastructure Architecture</h3>
      <p className="hint">
        Generated from the actual CDK stack definitions in <code>infra/lib/*.ts</code> — 5 stacks across{" "}
        <code>us-east-1</code> and <code>eu-west-1</code>. Also available as{" "}
        <code>infra/docs/architecture-diagram.html</code> in the repo.
      </p>

      <div className="legend">
        <span className="legend-item"><span className="legend-swatch" style={{ background: "#6c5ce0" }} />Edge / network</span>
        <span className="legend-item"><span className="legend-swatch" style={{ background: "#d14d68" }} />Auth &amp; identity</span>
        <span className="legend-item"><span className="legend-swatch" style={{ background: "#c6821a" }} />Compute (Lambda)</span>
        <span className="legend-item"><span className="legend-swatch" style={{ background: "#1e9a92" }} />Data (S3 / DynamoDB)</span>
        <span className="legend-item"><span className="legend-swatch" style={{ background: "#4c8f58" }} />CI/CD</span>
      </div>

      <h4>System overview</h4>
      <p className="hint">
        Three clients sit in front of two independently-deployed applications, sharing one Cognito user pool for
        identity. Presigned S3 URLs go straight from browser to bucket, bypassing CloudFront — that's why the media
        app's data plane lives in <code>eu-west-1</code> for UK latency and EU data residency, while CloudFront,
        Cognito, and the playground stack are pinned to <code>us-east-1</code>.
      </p>
      <Diagram diagramKey="overview" svg={svgs.overview ?? null} />

      <h4>Media app — request &amp; data flow</h4>
      <p className="hint">
        Every route on this API, and exactly which Lambda and storage each touches. <code>ThumbnailFn</code> is the
        only function not reachable from the API directly — it's triggered by S3 itself.
      </p>
      <Diagram diagramKey="mediaFlow" svg={svgs.mediaFlow ?? null} />

      <h4>Auth — passwordless sign-in</h4>
      <p className="hint">
        Every sign-in is the same Cognito <code>CUSTOM_AUTH</code> challenge chain — a 6-digit code emailed via SES,
        hashed and checked server-side. Access/ID tokens last 1 hour; the refresh token lasts 365 days and is never
        rotated.
      </p>
      <Diagram diagramKey="auth" svg={svgs.auth ?? null} />

      <h4>CI/CD — deploy topology</h4>
      <p className="hint">
        Three independently-scoped GitHub Actions pipelines, each assuming a purpose-built IAM role via OIDC — no
        long-lived AWS keys stored anywhere.
      </p>
      <Diagram diagramKey="cicd" svg={svgs.cicd ?? null} />
    </div>
  );
}
