"""
S3 adapter for Lambda - read/write/list/delete objects in the website bucket.
"""
import os
import boto3
from botocore.exceptions import ClientError


def _client():
    return boto3.client("s3")


def _bucket():
    return os.environ.get("S3_BUCKET", "swordthain-demo-sites")


def get_object(key: str) -> bytes:
    """Read object from S3. Returns empty bytes if not found."""
    try:
        r = _client().get_object(Bucket=_bucket(), Key=key)
        return r["Body"].read()
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "NoSuchKey":
            return b""
        raise


def get_object_str(key: str, encoding: str = "utf-8") -> str:
    """Read object as string."""
    return get_object(key).decode(encoding)


def put_object(key: str, body: bytes | str, content_type: str | None = None) -> None:
    """Write object to S3."""
    if isinstance(body, str):
        body = body.encode("utf-8")
    kwargs = {"Bucket": _bucket(), "Key": key, "Body": body}
    if content_type:
        kwargs["ContentType"] = content_type
    _client().put_object(**kwargs)


def list_prefixes(prefix: str = "", delimiter: str = "/") -> list[str]:
    """
    List top-level "folders" under a prefix (common prefixes).
    Returns list of prefix names (e.g. ["company-a", "company-b"]).
    """
    paginator = _client().get_paginator("list_objects_v2")
    prefixes = set()
    for page in paginator.paginate(Bucket=_bucket(), Prefix=prefix, Delimiter=delimiter):
        for cp in page.get("CommonPrefixes", []):
            p = cp["Prefix"].rstrip("/")
            if "/" in p:
                p = p.split("/")[-1]
            prefixes.add(p)
    return sorted(prefixes)


def list_keys(prefix: str) -> list[str]:
    """List all object keys under a prefix."""
    paginator = _client().get_paginator("list_objects_v2")
    keys = []
    for page in paginator.paginate(Bucket=_bucket(), Prefix=prefix):
        for obj in page.get("Contents", []):
            keys.append(obj["Key"])
    return keys


def delete_objects(keys: list[str]) -> None:
    """Delete multiple objects. Keys must be 1000 or fewer per call."""
    if not keys:
        return
    _client().delete_objects(
        Bucket=_bucket(),
        Delete={"Objects": [{"Key": k} for k in keys], "Quiet": True},
    )


def delete_prefix(prefix: str) -> None:
    """Delete all objects under a prefix."""
    keys = list_keys(prefix)
    while keys:
        delete_objects(keys[:1000])
        keys = keys[1000:]


def invalidate_cloudfront(paths: list[str] | None = None) -> None:
    """Create CloudFront invalidation for the given paths."""
    import uuid
    dist_id = os.environ.get("CLOUDFRONT_DISTRIBUTION_ID")
    if not dist_id:
        return
    paths = paths or ["/*"]
    cf = boto3.client("cloudfront")
    cf.create_invalidation(
        DistributionId=dist_id,
        InvalidationBatch={
            "Paths": {"Quantity": len(paths), "Items": paths},
            "CallerReference": str(uuid.uuid4()),
        },
    )
