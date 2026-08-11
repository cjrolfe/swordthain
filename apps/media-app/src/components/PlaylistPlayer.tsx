import { useEffect, useState } from "react";
import { api, PlaylistItem } from "../api";

export function PlaylistPlayer({
  playlistName,
  items,
  onClose,
}: {
  playlistName: string;
  items: PlaylistItem[];
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const current = items[index];
  const finished = index >= items.length;

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setUrl(null);
    api
      .viewUrl(current.mediaId)
      .then((res) => {
        if (cancelled) return;
        setUrl(res.url);
        setNotice(null); // clear a lingering skip notice from a previous item once one loads successfully
      })
      .catch(() => {
        if (cancelled) return;
        // A single bad item (revoked access, deleted media, expired link)
        // skips to the next one rather than halting the whole player.
        setNotice(`"${current.description || current.fileName || "This clip"}" is no longer available — skipping`);
        setIndex((i) => i + 1);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function skip() {
    setUrl(null);
    setNotice(null);
    setIndex((i) => i + 1);
  }

  function previous() {
    if (index === 0) return;
    setUrl(null);
    setNotice(null);
    setIndex((i) => i - 1);
  }

  return (
    <div className="lightbox-backdrop" onClick={onClose}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <button className="lightbox-close" onClick={onClose}>
          ✕
        </button>

        <div className="playlist-player-chrome">
          <span className="badge">{playlistName}</span>
          {!finished && (
            <span className="badge">
              {index + 1} of {items.length} — {current?.description || current?.fileName || "…"}
            </span>
          )}
        </div>
        {notice && <p className="hint">{notice}</p>}

        {finished && <p className="empty">Nothing left to play in this playlist.</p>}

        {!finished && !url && !notice && <p>Loading…</p>}

        {!finished && url && (
          // Same progressive-playback mechanism as Lightbox — view-url only,
          // never download-url. controlsList is a UI nicety, not a security
          // control: the real guarantee is that this component never calls
          // api.downloadUrl and never renders a download link anywhere.
          <video
            key={current!.mediaId}
            src={url}
            controls
            autoPlay
            controlsList="nodownload"
            disablePictureInPicture
            onEnded={() => setIndex((i) => i + 1)}
            onError={() => {
              setNotice(`"${current!.description || current!.fileName || "This clip"}" failed to play — skipping`);
              setIndex((i) => i + 1);
            }}
          />
        )}

        <div className="playlist-player-controls">
          <button onClick={previous} disabled={index === 0}>
            Previous
          </button>
          <button onClick={skip} disabled={finished}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
