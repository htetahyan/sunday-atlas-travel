import { useId, type ReactNode } from "react";

function RoundFlag({ children, viewBox }: { children: ReactNode; viewBox: string }) {
  return (
    <span className="inline-flex h-5 w-5 shrink-0 overflow-hidden rounded-full ring-1 ring-ink/20">
      <svg
        viewBox={viewBox}
        className="h-full w-full"
        aria-hidden="true"
        preserveAspectRatio="xMidYMid slice"
      >
        {children}
      </svg>
    </span>
  );
}

/** United Kingdom, Union Jack. */
export function FlagEn() {
  const raw = useId();
  const clip = `uj-${raw.replace(/:/g, "")}`;
  return (
    <RoundFlag viewBox="0 0 60 30">
      <defs>
        <clipPath id={clip}>
          <path d="M0 0h60v30H0z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <path fill="#012169" d="M0 0h60v30H0z" />
        <path stroke="#fff" strokeWidth="6" d="M0 0l60 30M60 0L0 30" />
        <path stroke="#C8102E" strokeWidth="4" d="M0 0l60 30M60 0L0 30" clipPath={`url(#${clip})`} />
        <path stroke="#fff" strokeWidth="10" d="M30 0v30M0 15h60" />
        <path stroke="#C8102E" strokeWidth="6" d="M30 0v30M0 15h60" />
      </g>
    </RoundFlag>
  );
}

/** Germany. */
export function FlagDe() {
  return (
    <RoundFlag viewBox="0 0 5 3">
      <rect width="5" height="1" fill="#000" />
      <rect y="1" width="5" height="1" fill="#DD0000" />
      <rect y="2" width="5" height="1" fill="#FFCE00" />
    </RoundFlag>
  );
}

/** France. */
export function FlagFr() {
  return (
    <RoundFlag viewBox="0 0 3 2">
      <rect width="1" height="2" fill="#002395" />
      <rect x="1" width="1" height="2" fill="#fff" />
      <rect x="2" width="1" height="2" fill="#ED2939" />
    </RoundFlag>
  );
}

/** Japan. */
export function FlagJa() {
  return (
    <RoundFlag viewBox="0 0 3 2">
      <rect width="3" height="2" fill="#fff" />
      <circle cx="1.5" cy="1" r="0.6" fill="#BC002D" />
    </RoundFlag>
  );
}

/** Spain, simplified, without the coat of arms. */
export function FlagEs() {
  return (
    <RoundFlag viewBox="0 0 60 40">
      <rect width="60" height="40" fill="#AA151B" />
      <rect y="10" width="60" height="20" fill="#F1BF00" />
    </RoundFlag>
  );
}

/** Simplified Chinese. A language mark, not a country flag (zh-Hans is read in several places). */
export function FlagZh() {
  return (
    <RoundFlag viewBox="0 0 30 30">
      <path fill="#C8102E" d="M0 0h30v30H0z" />
      <text
        x="15"
        y="21"
        textAnchor="middle"
        fontSize="17"
        fontWeight="700"
        fill="#FFDE00"
        fontFamily="'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif"
      >
        中
      </text>
    </RoundFlag>
  );
}
