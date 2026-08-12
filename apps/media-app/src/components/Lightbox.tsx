import { useEffect, useState } from "react";
import { api, MediaItem } from "../api";
import { Dialog } from "./Dialog";

export function Lightbox({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const displayName = item.description || item.fileName;

  useEffect(() => {
    let cancelled = false;
    api
      .viewUrl(item.mediaId)
      .then((res) => {
        if (!cancelled) setUrl(res.url);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [item.mediaId]);

  return (
    <Dialog onClose={onClose} labelledBy="lightbox-title">
      <button className="lightbox-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      {error && <p className="error" role="status">{error}</p>}
      {!error && !url && <p>Loading…</p>}
      {url && item.type === "photo" && <img src={url} alt={displayName} />}
      {url && item.type === "video" && (
        // Progressive playback via a direct presigned URL — browsers handle
        // seeking via HTTP Range requests natively. Adaptive-bitrate HLS
        // is a later phase (needs CloudFront + signed cookies, not just
        // presigned S3 URLs — see infra/README.md).
        <video src={url} controls autoPlay />
      )}
      <p id="lightbox-title" className="lightbox-caption">
        {displayName}
      </p>
    </Dialog>
  );
}
