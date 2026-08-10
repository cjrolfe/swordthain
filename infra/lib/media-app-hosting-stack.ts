import { Stack, StackProps, CfnOutput, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";

export interface MediaAppHostingStackProps extends StackProps {
  /**
   * Name of the static site's bucket, owned by MediaAppDataStack
   * (eu-west-1). Referenced by name/region rather than a construct
   * reference to avoid CDK's cross-region reference machinery — see
   * infra/README.md's "Region split" section.
   */
  siteBucketName: string;
  siteBucketRegion: string;
  /**
   * Custom domain aliases, e.g. ["swordthain.com", "www.swordthain.com"].
   * Left unset until the DNS cutover (see infra/README.md): CloudFront
   * refuses to let a second distribution claim an alias that's already
   * live on another one. Until then this distribution is verified at its
   * own *.cloudfront.net domain instead.
   */
  siteDomainNames?: string[];
  /** ACM cert (us-east-1) covering siteDomainNames — required together with it. */
  siteCertificateArn?: string;
  /** Where WAF security alarms are emailed. */
  alertEmail: string;
}

/**
 * apps/media-app's static site hosting: CloudFront distribution + WAF for
 * the built SPA in MediaAppDataStack's SiteBucket (eu-west-1). This stack
 * is forced to us-east-1 — CloudFront distributions, their ACM certs, and
 * CloudFront-scope WAFv2 Web ACLs can only be managed from there — but
 * that's just routing/edge config, no data, so it doesn't affect the
 * data-residency reasoning that moved everything else to eu-west-1.
 */
export class MediaAppHostingStack extends Stack {
  public readonly siteDistribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: MediaAppHostingStackProps) {
    super(scope, id, props);

    // Cross-region origin bucket — same pattern already proven for
    // LabsDistribution -> playground's eu-west-1 bucket (SwordthainPlaygroundStack).
    // Explicit `region` is required: without it CDK assumes same-region-as-stack
    // and builds the wrong regional S3 endpoint.
    const siteBucket = s3.Bucket.fromBucketAttributes(this, "SiteBucket", {
      bucketName: props.siteBucketName,
      region: props.siteBucketRegion,
    });

    // CloudFront-scope WAF (free managed rule groups).
    // Explicit `name` (rather than letting CloudFormation auto-generate one)
    // so the CloudWatch `WebACL` dimension is a known, stable value — needed
    // so MediaAppDataStack's StatsFn (a different stack/region) can query
    // this ACL's aggregate BlockedRequests metric without a cross-stack
    // reference, matching this codebase's existing region-split pattern of
    // passing plain known strings across the boundary instead.
    const siteWebAcl = new wafv2.CfnWebACL(this, "SiteWebAcl", {
      name: "swordthain-site-waf",
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: "swordthain-site-waf",
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
            metricName: "swordthain-site-common",
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
            metricName: "swordthain-site-badinputs",
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
            metricName: "swordthain-site-ipreputation",
          },
        },
      ],
    });

    const siteCertificate =
      props.siteCertificateArn && props.siteDomainNames?.length
        ? acm.Certificate.fromCertificateArn(this, "SiteCertificate", props.siteCertificateArn)
        : undefined;

    // CSP is scoped to this app's *real* network calls (not a generic
    // template): the API Gateway and Cognito IDP for fetch()/sign-in, and
    // the media S3 bucket for thumbnails/photos/video playback — omitting
    // any of these would silently break the app (blank media grid, or
    // nobody able to sign in at all).
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      // 'unsafe-inline' here (script-src stays strict) is for Mermaid's
      // client-rendered SVGs on the Architecture tab: mermaid.render()
      // embeds a <style> block per diagram for theming, with no way to
      // hash or nonce it from a static CDK config — same tradeoff already
      // made for labs.swordthain.com's hand-written inline styles.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https://swordthain-media-584000479246.s3.eu-west-1.amazonaws.com",
      "media-src 'self' https://swordthain-media-584000479246.s3.eu-west-1.amazonaws.com",
      "connect-src 'self' https://ox8boap6v6.execute-api.eu-west-1.amazonaws.com https://cognito-idp.us-east-1.amazonaws.com",
      "frame-ancestors 'none'",
    ].join("; ");

    // `server: AmazonS3` and `x-amz-server-side-encryption` are the S3
    // origin's untouched default headers, disclosing the hosting mechanism
    // to anyone probing the site — overridden here. Permissions-Policy has
    // no typed field on ResponseSecurityHeadersBehavior, so it's a plain
    // custom header alongside those overrides.
    const siteResponseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, "SiteResponseHeadersPolicy", {
      responseHeadersPolicyName: "swordthain-site-security-headers",
      comment: "Security headers + origin-header suppression for swordthain.com",
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: csp, override: true },
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
          { header: "Server", value: "cloudfront", override: true },
        ],
      },
      // CloudFront may not permit overriding a reserved header like `Server`
      // via customHeadersBehavior even with override:true — verify after
      // deploy; if it doesn't take, a viewer-response CloudFront Function
      // (matching the pattern already used for labs-stealth-gate.js) is the
      // fallback rather than fighting the response headers policy.
      removeHeaders: ["x-amz-server-side-encryption"],
    });

    this.siteDistribution = new cloudfront.Distribution(this, "SiteDistribution", {
      comment: "apps/media-app static site (swordthain.com root domain)",
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: siteResponseHeadersPolicy,
      },
      webAclId: siteWebAcl.attrArn,
      domainNames: siteCertificate ? props.siteDomainNames : undefined,
      certificate: siteCertificate,
    });

    new CfnOutput(this, "SiteDistributionId", { value: this.siteDistribution.distributionId });
    new CfnOutput(this, "SiteDistributionDomainName", { value: this.siteDistribution.distributionDomainName });

    // --- Security alerting: email if WAF starts blocking a lot of requests ---
    const siteAlertsTopic = new sns.Topic(this, "SiteAlertsTopic", {
      topicName: "swordthain-site-alerts",
    });
    siteAlertsTopic.addSubscription(new snsSubscriptions.EmailSubscription(props.alertEmail));

    new cloudwatch.Alarm(this, "WafBlockedRequestsAlarm", {
      alarmName: "swordthain-waf-blocked-requests",
      metric: new cloudwatch.Metric({
        namespace: "AWS/WAFV2",
        metricName: "BlockedRequests",
        // Rule=<the ACL's own metricName> is WAF's aggregate "blocked by
        // any rule" count, not a specific rule group — confirmed against
        // the real deployed metrics rather than assumed from docs.
        dimensionsMap: { WebACL: "swordthain-site-waf", Rule: "swordthain-site-waf" },
        statistic: "Sum",
        period: Duration.hours(1),
      }),
      threshold: 20,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new cloudwatchActions.SnsAction(siteAlertsTopic));
  }
}
