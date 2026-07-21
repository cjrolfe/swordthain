/**
 * Decorative login-screen illustration: an old top-loading VCR with a VHS
 * tape half-ejected, showing a worn generic sci-fi label (stars + a
 * silhouetted figure) with a hand-labeled "Swordthain" sticker stuck over
 * part of it in felt tip. Deliberately generic artwork, not a recreation
 * of any real film's actual packaging/logo.
 *
 * The label and sticker are nested inside the *same* rotated <g> as the
 * tape body — keeping them in one shared local coordinate space is what
 * makes the sticker sit convincingly on the label's surface at the tape's
 * own angle, rather than drifting off at a mismatched angle if it were a
 * separately-rotated sibling.
 */
export function VcrIllustration() {
  return (
    <svg
      className="vcr-illustration"
      viewBox="0 0 480 320"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="An old VCR with a video tape labeled Swordthain sticking out of it"
    >
      <defs>
        <radialGradient id="vcrGlow" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#3a3f4a" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#3a3f4a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="vcrBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4a4e56" />
          <stop offset="12%" stopColor="#3a3d44" />
          <stop offset="100%" stopColor="#232529" />
        </linearGradient>
        <linearGradient id="tapeBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a2a2e" />
          <stop offset="100%" stopColor="#111113" />
        </linearGradient>
        <linearGradient id="labelPaper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f2ead9" />
          <stop offset="100%" stopColor="#e4d9c0" />
        </linearGradient>
        <linearGradient id="stickerPaper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fffdf7" />
          <stop offset="100%" stopColor="#f4ecd8" />
        </linearGradient>
      </defs>

      <ellipse cx="240" cy="150" rx="220" ry="140" fill="url(#vcrGlow)" />

      {/* shelf shadow */}
      <ellipse cx="240" cy="272" rx="170" ry="14" fill="#000" opacity="0.28" />

      {/* VHS tape, emerging from the slot at an angle — label, starfield,
          silhouette, and sticker all share this one rotated coordinate space */}
      <g transform="translate(150 34) rotate(-6)">
        <rect x="0" y="0" width="230" height="130" rx="6" fill="url(#tapeBody)" />
        <rect x="0" y="0" width="230" height="130" rx="6" fill="none" stroke="#000" strokeOpacity="0.4" />
        {/* reel windows */}
        <circle cx="34" cy="108" r="13" fill="#050506" stroke="#3a3a3e" strokeWidth="2" />
        <circle cx="196" cy="108" r="13" fill="#050506" stroke="#3a3a3e" strokeWidth="2" />
        <rect x="10" y="118" width="210" height="6" rx="2" fill="#000" opacity="0.5" />

        {/* worn label */}
        <g transform="translate(14 12)">
          <rect width="202" height="84" rx="3" fill="url(#labelPaper)" />
          <rect width="202" height="84" rx="3" fill="none" stroke="#c9bb98" strokeWidth="1" />

          {/* faded starfield, spread across the whole label so some peek out beside the sticker */}
          <g fill="#7a7460" opacity="0.7">
            <circle cx="18" cy="12" r="1.1" />
            <circle cx="40" cy="8" r="0.8" />
            <circle cx="66" cy="16" r="1" />
            <circle cx="150" cy="10" r="1" />
            <circle cx="178" cy="18" r="1.2" />
            <circle cx="190" cy="8" r="0.7" />
            <circle cx="164" cy="30" r="0.9" />
            <circle cx="185" cy="42" r="1" />
            <circle cx="170" cy="58" r="0.8" />
            <circle cx="24" cy="70" r="0.8" />
            <circle cx="192" cy="70" r="0.9" />
          </g>

          {/* silhouetted figure with a glowing blade, tucked in the label's
              right-hand third so it reads clearly beside the sticker */}
          <g transform="translate(172 46)">
            <path
              d="M0 30 C-7 30 -10 25 -10 18 L-8 8 C-7 3 -4 0 0 0 C4 0 7 3 8 8 L10 18 C10 25 7 30 0 30 Z"
              fill="#2c2a24"
              opacity="0.9"
            />
            <rect x="-2" y="-19" width="4" height="21" rx="2" fill="#4a7dff" opacity="0.9" />
            <rect x="-2" y="-19" width="4" height="21" rx="2" fill="#9db8ff" opacity="0.55" />
          </g>
        </g>

        {/* Swordthain sticker, stuck over the left two-thirds of the label
            at a jaunty angle — same local space as the label above, so it
            tracks the tape's own -6° tilt instead of fighting it */}
        <g transform="translate(24 22) rotate(5)">
          <path
            d="M2 8 C1 3 7 -1 14 0 L128 -2 C135 -3 140 2 139 8 L137 39 C138 44 132 48 125 47 L12 49 C5 50 0 45 1 40 Z"
            fill="url(#stickerPaper)"
            stroke="#d8c9a3"
            strokeWidth="1"
          />
          <text
            x="69"
            y="30"
            textAnchor="middle"
            fontFamily="'Segoe Print','Bradley Hand','Comic Sans MS',cursive"
            fontSize="22"
            fill="#233a2b"
            transform="rotate(-2 69 30)"
          >
            Swordthain
          </text>
        </g>
      </g>

      {/* VCR body */}
      <rect x="30" y="150" width="420" height="118" rx="10" fill="url(#vcrBody)" />
      <rect x="30" y="150" width="420" height="10" rx="5" fill="#5a5f68" opacity="0.6" />
      <rect x="30" y="150" width="420" height="118" rx="10" fill="none" stroke="#15161a" strokeWidth="1.5" />

      {/* tape slot */}
      <rect x="140" y="150" width="200" height="14" rx="3" fill="#0c0d0f" />
      <rect x="140" y="150" width="200" height="4" rx="2" fill="#000" opacity="0.6" />

      {/* LED display */}
      <rect x="58" y="176" width="86" height="26" rx="3" fill="#0c0d0f" />
      <text x="101" y="195" textAnchor="middle" fontFamily="'Courier New',monospace" fontSize="16" fill="#e0483f">
        12:00
      </text>

      {/* transport buttons */}
      <g>
        {[0, 1, 2, 3, 4].map((i) => (
          <rect
            key={i}
            x={220 + i * 40}
            y={182}
            width={30}
            height={14}
            rx={3}
            fill="#4a4e56"
            stroke="#15161a"
            strokeWidth="1"
          />
        ))}
        <path d="M228 185 l8 4 l-8 4 Z" fill="#c7cad1" />
        <path d="M266 185 l-4 4 l4 4 M270 185 l-4 4 l4 4" fill="none" stroke="#c7cad1" strokeWidth="1.4" />
        <path d="M306 185 l4 4 l-4 4 M310 185 l4 4 l-4 4" fill="none" stroke="#c7cad1" strokeWidth="1.4" />
        <rect x="343" y="185" width="8" height="8" fill="#c7cad1" />
        <path d="M383 185 l8 4 l-8 4 Z M391 185 v8" fill="none" stroke="#c7cad1" strokeWidth="1.4" />
      </g>

      {/* small power LED */}
      <circle cx="404" cy="230" r="3.5" fill="#59c26a" />
      <circle cx="404" cy="230" r="6" fill="#59c26a" opacity="0.35" />

      {/* vents */}
      <g stroke="#15161a" strokeWidth="2" opacity="0.5">
        <line x1="58" y1="232" x2="58" y2="252" />
        <line x1="66" y1="232" x2="66" y2="252" />
        <line x1="74" y1="232" x2="74" y2="252" />
        <line x1="82" y1="232" x2="82" y2="252" />
      </g>
    </svg>
  );
}
