import { Duration, Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as path from "node:path";

export interface PlaygroundStackProps extends StackProps {
  /** Root domain, e.g. "swordthain.com" — the hosted zone labsSubdomain lives under. */
  domainName: string;
  hostedZoneId: string;
  /** Full subdomain to alias, e.g. "labs.swordthain.com". */
  labsSubdomain: string;
  /** apps/playground's existing S3 bucket name, referenced by name only —
   * deliberately NOT imported into CDK management (see infra/README.md):
   * this stack must not risk playground's currently-working manual deploy. */
  playgroundBucketName: string;
  /** apps/playground's existing REST API v1 (id only — same "reference,
   * don't adopt" rule as the bucket above). */
  playgroundApiId: string;
  /** That same REST API's root ("/") resource id — needed to add new
   * CDK-managed child resources without importing/adopting the whole API. */
  playgroundRootResourceId: string;
  /** Shared Cognito pool from SwordthainAuthStack, backing the new authorizer. */
  userPool: cognito.IUserPool;
}

/**
 * New hosting for apps/playground at labs.swordthain.com, per the spec's
 * section 9 (owner-only, stealth-gated by a plain 404 for anyone not
 * already signed in). Everything here is new infrastructure — playground's
 * existing bucket and Lambda (managed manually, see CiStack's
 * swordthain-playground-ci role) are only referenced, never adopted.
 */
export class PlaygroundStack extends Stack {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: PlaygroundStackProps) {
    super(scope, id, props);

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, "HostedZone", {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.domainName,
    });

    const certificate = new acm.Certificate(this, "LabsCertificate", {
      domainName: props.labsSubdomain,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // Referenced by name/region only, not full CDK management — CDK's
    // `addToResourcePolicy` is a no-op on an imported bucket regardless, so
    // the bucket policy grant for this distribution's OAC is a one-time
    // manual step (see infra/README.md), not CDK-managed. That's
    // deliberate: this stack must never risk mutating (or CDK later
    // reconciling away) the bucket policy the *existing* playground
    // distribution's OAC still depends on.
    //
    // `region` must be explicit: the bucket is actually in eu-west-1, not
    // this stack's us-east-1 (CloudFront/ACM/WAFv2-for-CloudFront all
    // require us-east-1, forcing this stack there regardless of where the
    // bucket lives). Without it, CDK assumes same-region-as-stack and
    // builds the wrong regional endpoint — confirmed by a real
    // PermanentRedirect from S3 when this was omitted.
    const playgroundBucket = s3.Bucket.fromBucketAttributes(this, "PlaygroundBucket", {
      bucketName: props.playgroundBucketName,
      region: "eu-west-1",
    });

    const stealthGateFn = new cloudfront.Function(this, "StealthGateFn", {
      functionName: "swordthain-labs-stealth-gate",
      code: cloudfront.FunctionCode.fromFile({
        filePath: path.join(__dirname, "..", "cloudfront-functions", "labs-stealth-gate.js"),
      }),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: "Stealth-only 404 gate for labs.swordthain.com — not the real access boundary.",
    });

    // CloudFront-scope WAF — same free managed rule groups as
    // MediaAppStack's SiteWebAcl (see that stack for why this only works
    // on CloudFront, not the media API's HTTP Gateway API).
    const labsWebAcl = new wafv2.CfnWebACL(this, "LabsWebAcl", {
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: "swordthain-labs-waf",
      },
      rules: [
        {
          name: "AWS-AWSManagedRulesCommonRuleSet",
          priority: 0,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesCommonRuleSet" },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "swordthain-labs-common",
          },
        },
        {
          name: "AWS-AWSManagedRulesKnownBadInputsRuleSet",
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesKnownBadInputsRuleSet" },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "swordthain-labs-badinputs",
          },
        },
        {
          name: "AWS-AWSManagedRulesAmazonIpReputationList",
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesAmazonIpReputationList" },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "swordthain-labs-ipreputation",
          },
        },
      ],
    });

    // All inline <script> blocks across apps/playground have been migrated
    // to external files (see apps/playground/assets/*.js and the per-page
    // <script src> references) — CSP is now enforced rather than
    // Report-Only. script-src allows the one third-party script actually in
    // use (Mermaid, on docs/codebase-diagram.html via jsdelivr); connect-src
    // allows the playground's own API Gateway, which every page's
    // create/archive/delete/api-testing fetch() call depends on — omitting
    // either would silently break real functionality despite passing a
    // superficial "no more inline scripts" check.
    const labsCsp = [
      "default-src 'self'",
      "script-src 'self' https://cdn.jsdelivr.net",
      // Numerous inline style="..." attributes across these hand-written
      // pages (e.g. index.html's card links) — out of scope for this pass
      // (unlike script-src, migrating every inline style to a CSS class is
      // a much larger, separate cleanup). Leaving style-src unset would
      // fall back to default-src 'self', which blocks inline style
      // attributes too and silently breaks layout — explicit and scoped to
      // styles only, script-src/connect-src/img-src stay tight.
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' https://x7g9r0sdmc.execute-api.us-east-1.amazonaws.com",
      // Company logos are always the known S3 bucket, but each generated
      // company page's screenshot is scraped from that company's own real
      // website (an Open Graph image URL — see create_company.py) at
      // page-creation time, so there's no fixed set of origins to
      // allowlist. Images are a low-severity CSP vector compared to
      // script-src/connect-src, so this is a deliberate, scoped-down
      // exception rather than loosening the policy generally.
      "img-src 'self' https:",
      "frame-ancestors 'none'",
    ].join("; ");

    const labsResponseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, "LabsResponseHeadersPolicy", {
      responseHeadersPolicyName: "swordthain-labs-security-headers",
      comment: "Security headers for labs.swordthain.com, including an enforced CSP",
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: labsCsp, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          preload: true,
          override: true,
        },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        contentTypeOptions: { override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), fullscreen=()", override: true },
        ],
      },
    });

    this.distribution = new cloudfront.Distribution(this, "LabsDistribution", {
      comment: "apps/playground (labs.swordthain.com) — stealth-gated, Owner-only",
      defaultRootObject: "index.html",
      domainNames: [props.labsSubdomain],
      certificate,
      webAclId: labsWebAcl.attrArn,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(playgroundBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          { function: stealthGateFn, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
        responseHeadersPolicy: labsResponseHeadersPolicy,
      },
    });

    new route53.ARecord(this, "LabsAliasRecord", {
      zone: hostedZone,
      recordName: props.labsSubdomain,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution)),
    });

    new CfnOutput(this, "LabsDistributionId", { value: this.distribution.distributionId });
    new CfnOutput(this, "LabsDistributionDomainName", { value: this.distribution.distributionDomainName });
    new CfnOutput(this, "LabsCertificateArn", { value: certificate.certificateArn });

    // --- Auth retrofit for playground's REST API (defined here, attached manually) ---
    // Only the authorizer resource itself is CDK-managed. Attaching it to
    // the 4 existing methods and redeploying the `prod` stage is a
    // one-time AWS CLI step (see infra/README.md) — CDK didn't create
    // those methods (they predate this stack, on an API referenced by ID
    // only, same as the bucket above) and can't cleanly take ownership of
    // mutating them without risking an import/adopt of the whole API. Any
    // *new* playground endpoint added later should reference this
    // authorizer at creation time instead of going through the one-time
    // script again.
    const playgroundAuthorizer = new apigateway.CfnAuthorizer(this, "PlaygroundAuthorizer", {
      restApiId: props.playgroundApiId,
      name: "swordthain-playground-cognito-authorizer",
      type: "COGNITO_USER_POOLS",
      identitySource: "method.request.header.Authorization",
      providerArns: [props.userPool.userPoolArn],
    });

    new CfnOutput(this, "PlaygroundAuthorizerId", { value: playgroundAuthorizer.ref });

    // --- API Testing playground: a new /api-testing endpoint on the same
    // REST API, referencing playgroundAuthorizer above at creation time —
    // exactly the pattern its own comment anticipated, rather than the
    // one-time manual-attach script used for the 4 pre-existing methods. ---
    const apiTestingProxyFn = new NodejsFunction(this, "ApiTestingProxyFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "..", "lambda", "playground", "api-testing-proxy.ts"),
      timeout: Duration.seconds(15),
      memorySize: 256,
      bundling: {
        externalModules: [],
      },
    });
    // Real third-party API keys live in SSM SecureString parameters, never
    // in code — populated out-of-band via `aws ssm put-parameter`, only the
    // parameter *path* (not the secret value) appears here.
    apiTestingProxyFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/swordthain/api-testing/*`],
      })
    );

    // Imported by ID/root-resource-id only — same "reference, don't adopt"
    // rule as playgroundBucket above — so adding this one new resource
    // can't risk CDK trying to reconcile the whole existing API tree.
    const importedPlaygroundApi = apigateway.RestApi.fromRestApiAttributes(this, "ImportedPlaygroundApi", {
      restApiId: props.playgroundApiId,
      rootResourceId: props.playgroundRootResourceId,
    });

    const apiTestingResource = importedPlaygroundApi.root.addResource("api-testing", {
      defaultCorsPreflightOptions: {
        allowOrigins: ["*"],
        allowMethods: ["POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "X-Amz-Date", "Authorization", "X-Api-Key", "X-Amz-Security-Token"],
      },
    });
    apiTestingResource.addMethod("POST", new apigateway.LambdaIntegration(apiTestingProxyFn), {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: { authorizerId: playgroundAuthorizer.ref },
    });

    // CDK adding a resource/method to an *imported* REST API doesn't create
    // a new deployment on its own — same one-time-manual-step rule as the
    // authorizer attachment above. After `cdk deploy`, run:
    //   aws apigateway create-deployment --rest-api-id <playgroundApiId> --stage-name prod
    new CfnOutput(this, "ApiTestingProxyFnName", { value: apiTestingProxyFn.functionName });
  }
}
