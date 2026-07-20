import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
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
    const siteWebAcl = new wafv2.CfnWebACL(this, "SiteWebAcl", {
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

    this.siteDistribution = new cloudfront.Distribution(this, "SiteDistribution", {
      comment: "apps/media-app static site (swordthain.com root domain)",
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      webAclId: siteWebAcl.attrArn,
      domainNames: siteCertificate ? props.siteDomainNames : undefined,
      certificate: siteCertificate,
    });

    new CfnOutput(this, "SiteDistributionId", { value: this.siteDistribution.distributionId });
    new CfnOutput(this, "SiteDistributionDomainName", { value: this.siteDistribution.distributionDomainName });
  }
}
