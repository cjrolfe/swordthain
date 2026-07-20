import { useEffect, useState } from "react";
import { api, MediaItem } from "../api";

export function Lightbox({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="lightbox-backdrop" onClick={onClose}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <button className="lightbox-close" onClick={onClose}>
          ✕
        </button>
        {error && <p className="error">{error}</p>}
        {!error && !url && <p>Loading…</p>}
        {url && item.type === "photo" && <img src={url} alt={item.fileName} />}
        {url && item.type === "video" && (
          // Progressive playback via a direct presigned URL — browsers handle
          // seeking via HTTP Range requests natively. Adaptive-bitrate HLS
          // is a later phase (needs CloudFront + signed cookies, not just
          // presigned S3 URLs — see infra/README.md).
          <video src={url} controls autoPlay />
        )}
      </div>
    </div>
  );
}
