/**
 * The cafe mascot — 100% original hand-authored chibi character.
 *
 * Deliberately NOT any existing anime character: big round eyes, rosy cheeks,
 * a terracotta scarf and a roasted-brown barista apron. See docs/anime-theme.md
 * §4 and §7 (the theme doc explicitly forbids reusing licensed IP).
 *
 * Rendered as inline SVG so it costs zero extra network requests and scales to
 * any size crisply.
 */

export type MascotMood = "happy" | "cheer" | "sleepy" | "worry";

const HAIR = "#4A2C1B";
const HAIR_LIGHT = "#6B4128";
const SKIN = "#FBE0CC";
const SKIN_SHADE = "#F2CDB2";
const BLUSH = "#F2A7A0";
const EYE = "#3E2418";
const APRON = "#7A3E1D";
const APRON_LIGHT = "#9C5730";
const SCARF = "#C97B3D";
const SCARF_DARK = "#B26A31";
const MUSTARD = "#E8A93E";

const MOOD: Record<
  MascotMood,
  { eyes: React.ReactNode; mouth: React.ReactNode }
> = {
  // relaxed open smile
  happy: {
    eyes: (
      <>
        <ellipse cx="47" cy="55" rx="6.5" ry="7.5" fill={EYE} />
        <ellipse cx="73" cy="55" rx="6.5" ry="7.5" fill={EYE} />
        <circle cx="45" cy="52" r="2.4" fill="#fff" />
        <circle cx="71" cy="52" r="2.4" fill="#fff" />
      </>
    ),
    mouth: (
      <path
        d="M53 68q7 7 14 0"
        stroke={EYE}
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
    ),
  },
  // eyes squeezed shut + open mouth: used for order confirmations
  cheer: {
    eyes: (
      <>
        <path
          d="M40.5 55.5q6.5-8 13 0"
          stroke={EYE}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M66.5 55.5q6.5-8 13 0"
          stroke={EYE}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      </>
    ),
    mouth: (
      <path
        d="M52 67.5q8 10 16 0z"
        fill={EYE}
        stroke={EYE}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    ),
  },
  // half-lidded: loading / waiting
  sleepy: {
    eyes: (
      <>
        <path
          d="M40.5 55q6.5 5 13 0"
          stroke={EYE}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M66.5 55q6.5 5 13 0"
          stroke={EYE}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      </>
    ),
    mouth: (
      <path
        d="M55 69h10"
        stroke={EYE}
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
    ),
  },
  // small o-mouth + raised brows: empty states
  worry: {
    eyes: (
      <>
        <ellipse cx="47" cy="57" rx="5.5" ry="6" fill={EYE} />
        <ellipse cx="73" cy="57" rx="5.5" ry="6" fill={EYE} />
        <circle cx="45.5" cy="55" r="2" fill="#fff" />
        <circle cx="71.5" cy="55" r="2" fill="#fff" />
        <path
          d="M40 45.5l9 2.5M80 45.5l-9 2.5"
          stroke={EYE}
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />
      </>
    ),
    mouth: <ellipse cx="60" cy="70" rx="4" ry="3.4" fill={EYE} />,
  },
};

export interface MascotProps {
  mood?: MascotMood;
  /** Rendered height in px. Width follows the 120:132 viewBox ratio. */
  size?: number;
  className?: string;
  /** Hide the animated bob (used inside print stylesheets). */
  still?: boolean;
}

export function Mascot({
  mood = "happy",
  size = 120,
  className = "",
  still = false,
}: MascotProps) {
  const { eyes, mouth } = MOOD[mood];

  return (
    <svg
      viewBox="0 0 120 132"
      width={(size * 120) / 132}
      height={size}
      role="img"
      aria-label="Mochi, the cafe barista mascot"
      className={`${still ? "" : "animate-bob"} ${className}`}
    >
      <title>Mochi, the cafe barista mascot</title>

      {/* ---- body: apron over a cream tee ---- */}
      <g>
        <path
          d="M60 96c-19 0-33 11-36 26-1 5-1 8-1 10h74c0-2 0-5-1-10-3-15-17-26-36-26z"
          fill={APRON}
        />
        {/* apron pocket */}
        <path
          d="M47 116h26v10c0 2-2 4-4 4H51c-2 0-4-2-4-4z"
          fill={APRON_LIGHT}
          opacity=".85"
        />
        {/* little bean emblem on the pocket */}
        <g transform="rotate(-18 60 124)">
          <ellipse cx="60" cy="124" rx="4.4" ry="6" fill={MUSTARD} />
          <path
            d="M58.4 118.8c1.6 2.4 1.2 4.2 0 5.6-1.2 1.4-1.6 3.2 0 5.6"
            fill="none"
            stroke={APRON}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </g>
        {/* tee collar + apron straps */}
        <path d="M50 95l10 9 10-9 5 3-15 13-15-13z" fill="#FFF8F0" />
        <path
          d="M45 99c-2 5-3 10-3 16M75 99c2 5 3 10 3 16"
          stroke={APRON_LIGHT}
          strokeWidth="3.4"
          strokeLinecap="round"
          fill="none"
        />
      </g>

      {/* ---- scarf ---- */}
      <g>
        <path
          d="M38 84c6 6 38 6 44 0 1 5 1 8 0 11-8 6-36 6-44 0-1-3-1-6 0-11z"
          fill={SCARF}
        />
        <path d="M74 93l9 12-8 5-9-13z" fill={SCARF_DARK} />
        <path
          d="M42 88c5 3 31 3 36 0"
          stroke={SCARF_DARK}
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
          opacity=".6"
        />
      </g>

      {/* ---- head ---- */}
      <g>
        <path
          d="M60 18c-19 0-33 13-33 33 0 15 7 28 18 33 5 2 10 3 15 3s10-1 15-3c11-5 18-18 18-33 0-20-14-33-33-33z"
          fill={SKIN}
        />
        {/* ears */}
        <ellipse cx="27.5" cy="58" rx="5" ry="6.5" fill={SKIN_SHADE} />
        <ellipse cx="92.5" cy="58" rx="5" ry="6.5" fill={SKIN_SHADE} />
        {/* jaw shading */}
        <path
          d="M60 17c19 0 33 13 33 33 0 4-.4 8-1.2 11.6-1.6-21-14-33.6-31.8-33.6S31.8 40.6 30.2 61.6C29.4 58 29 54 29 50c0-20 12-33 31-33z"
          fill={HAIR}
        />
        {/* side-swept fringe */}
        <path
          d="M29.5 52.5c1-19 14-31.5 30.5-31.5S89.5 33.5 90.5 52.5c.3 4.7-.1 8.6-.9 11.6-.6-8-2.6-14.3-6-17.6-3.4 4.4-11.6 7.6-21.2 7.6-8 0-15.4-2.4-20-6.6-4.9 3.4-8.4 8.6-9.6 16.6-1.2-3.4-1.6-7.2-1.3-11.6z"
          fill={HAIR}
        />
        <path
          d="M32 40c4-6 10-9.6 16-10.4-6.6 3.2-11.4 8.4-13.6 15.4-1 1.6-2 1.8-2.4.4z"
          fill={HAIR_LIGHT}
        />
        {/* ahoge: one sticking-up strand, pure chibi law */}
        <path
          d="M58 20c-2-6 1-11 6-13-1 3-.4 5 1.6 6.6 1.8 1.4 2.6 3.2 2.4 5.4z"
          fill={HAIR}
        />
        {/* coffee-bean hair clip, right side */}
        <g transform="rotate(-18 84 40)">
          <ellipse cx="84" cy="40" rx="6" ry="8" fill={MUSTARD} />
          <path
            d="M84 33.5c2 2.4 3 4.4 3 6.5s-1 4.1-3 6.5c-2-2.4-3-4.4-3-6.5s1-4.1 3-6.5z"
            fill={APRON}
            opacity=".55"
          />
        </g>
      </g>

      {/* ---- face ---- */}
      <g>
        {/* brows */}
        <path
          d="M40 45.5q7-3 14-1M80 45.5q-7-3-14-1"
          stroke={HAIR}
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
        />
        {eyes}
        {/* rosy cheeks */}
        <ellipse cx="37" cy="67" rx="6" ry="3.6" fill={BLUSH} opacity=".75" />
        <ellipse cx="83" cy="67" rx="6" ry="3.6" fill={BLUSH} opacity=".75" />
        {mouth}
      </g>
    </svg>
  );
}

export default Mascot;
