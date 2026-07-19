# Swordthain Infra (CDK)

Shared AWS infrastructure for swordthain.com, in TypeScript via AWS CDK. Deployed independently of `apps/media-app` and `apps/playground` — those apps' own CDK stacks (added in later phases) will reference this stack's outputs.

## Stacks

### `SwordthainAuthStack`
The Cognito User Pool shared by both apps: friends sign in as `Member`, the owner as `Owner` (Cognito group, checked explicitly in app code — see the spec's section 9 on the playground's access control).

- **Passwordless email-OTP sign-in**, implemented as a Cognito custom authentication challenge (not Cognito's native "choice-based auth" — that mechanism requires password as an allowed factor, which doesn't fit a fully passwordless design):
  - `DefineAuthChallengeFn` — orchestrates the challenge, allows up to 3 attempts per sign-in session.
  - `CreateAuthChallengeFn` — generates a 6-digit code on the first attempt of a session, stores its hash in DynamoDB (`swordthain-otp-codes`, 5-minute TTL), and emails it via SES.
  - `VerifyAuthChallengeResponseFn` — checks the submitted code against the stored hash, single-use (deleted on success).
- **SES identity** for `swordthain.com` is provisioned and DNS-verified automatically (DKIM CNAMEs + MAIL FROM MX/TXT records added to the existing Route 53 hosted zone).
- **No password path**: the app client only allows `ALLOW_CUSTOM_AUTH` + `ALLOW_REFRESH_TOKEN_AUTH`. OAuth/Hosted UI is disabled — the app talks to Cognito directly.
- **Long-lived sessions**: refresh tokens valid 365 days (long-lived session per device, including smart TVs), access/ID tokens 1 hour.
- **MFA**: optional TOTP, on top of the inherent OTP-per-login factor.
- Owner/Member groups created; role checks should key off group membership, not a separate custom attribute.

**Not yet included — deliberately deferred:**
- Passkey/WebAuthn sign-in. Cognito's native passkey support lives in a different, newer auth-selection mechanism than the custom-Lambda OTP flow above, and forces `password` to remain an allowed factor — worth its own design pass rather than bolting on.
- Everything else in the spec (S3 media bucket, DynamoDB app tables, API Gateway, MediaConvert, WAF Bot Control, the two apps' own stacks) — later phases.

## Prerequisites

- Node.js 20+ (this repo was set up with Node 26 / npm 11).
- AWS credentials for account `584000479246` with permissions well beyond the read-only audit role — `cdk bootstrap` and `cdk deploy` create/modify CloudFormation stacks, IAM roles, Lambda functions, DynamoDB tables, Cognito resources, SES identities, and Route 53 records. A scoped policy or `AdministratorAccess`/`PowerUserAccess` + IAM role creation is realistically required.

## Commands

```bash
cd infra
npm install
npx tsc --noEmit      # type-check
npx cdk synth          # render CloudFormation locally, no AWS calls
npx cdk bootstrap       # one-time per account/region — creates CDK's asset bucket etc.
npx cdk diff            # compare against what's deployed
npx cdk deploy           # deploy SwordthainAuthStack
```

`cdk synth` has been run locally and produces a valid template (27 resources) — nothing has been deployed to AWS yet.
