/** Decorative contour lines. Hidden from assistive tech. */
export function TopoBackdrop() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full text-teal"
      viewBox="0 0 1200 640"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.28">
        <path d="M-20 120 C 140 80, 220 180, 380 150 S 620 40, 820 120 1100 80, 1240 150" />
        <path d="M-20 180 C 160 140, 260 250, 420 210 S 680 90, 880 180 1120 140, 1240 210" />
        <path d="M-20 250 C 180 200, 300 320, 470 270 S 740 150, 940 240 1160 210, 1240 280" />
        <path d="M-20 330 C 150 290, 320 410, 500 350 S 780 230, 990 330 1180 290, 1240 360" />
        <path d="M-40 430 C 180 380, 340 520, 560 450 S 860 340, 1040 450 1200 400, 1260 470" />
        <path d="M80 520 C 240 470, 380 600, 560 540 S 820 460, 1000 560 1180 500, 1280 580" />
      </g>
      <g fill="none" stroke="#C8794A" strokeWidth="1.2" opacity="0.35">
        <path d="M760 40 C 820 120, 900 80, 980 160 S 1120 220, 1220 140" />
        <path d="M800 70 C 860 150, 940 110, 1020 190" />
      </g>
    </svg>
  );
}
