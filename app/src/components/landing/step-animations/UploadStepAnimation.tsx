import { useCurrentFrame, AbsoluteFill, interpolate } from "remotion";

export const UPLOAD_ANIMATION_FPS = 30;
export const UPLOAD_ANIMATION_DURATION_FRAMES = 150; // 5s seamless loop
export const UPLOAD_ANIMATION_SIZE = 480;

const RED = "#a41f24";
const RED_SOFT = "#c63939";
const RED_FIXED = "#ffdad7";
const RED_FIXED_DIM = "#ffb3ae";
const GREY_LINE = "#d9d3d2";
const GREY_LINE_SOFT = "#e5e2e1";

/** sine wave that repeats perfectly across one loop, so there is never a jump cut at the seam */
function loopWave(frame: number, cycles: number, phase = 0) {
  const t = frame / UPLOAD_ANIMATION_DURATION_FRAMES;
  return Math.sin(t * Math.PI * 2 * cycles + phase);
}

/** 0..1 pulse, repeats perfectly across one loop */
function loopPulse(frame: number, cycles: number, phase = 0) {
  return 0.5 + 0.5 * loopWave(frame, cycles, phase);
}

export const UploadStepAnimation: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / UPLOAD_ANIMATION_DURATION_FRAMES;

  // --- base platform: the only thing allowed to move as a whole, gentle float only ---
  const baseFloat = loopWave(frame, 1) * 6;

  // --- central document: checkmark cascade (4 rows, staggered wave) ---
  const rowGlow = (index: number) => loopPulse(frame, 1, (index / 4) * Math.PI * 2);

  // --- arrow drop-in loop: falls, lands, fades, resets ---
  const dropT = t; // single drop cycle per loop
  const arrowY = interpolate(dropT, [0, 0.85, 1], [-18, 22, -18]);
  const arrowOpacity = interpolate(
    dropT,
    [0, 0.08, 0.75, 0.88, 1],
    [0, 1, 1, 0, 0]
  );
  const rippleScale = interpolate(dropT, [0.78, 0.95, 1], [0.6, 1.6, 0.6]);
  const rippleOpacity = interpolate(dropT, [0.78, 0.85, 1], [0, 0.5, 0]);

  // --- left browser card: floats out of phase with the base ---
  const leftFloat = loopWave(frame, 1, Math.PI) * 5;
  const dot1 = loopPulse(frame, 1, 0);
  const dot2 = loopPulse(frame, 1, (Math.PI * 2) / 3);
  const dot3 = loopPulse(frame, 1, (Math.PI * 4) / 3);
  const shimmer = 0.55 + 0.45 * loopPulse(frame, 2);

  // --- right notification stack: staggered drift + message pulse ---
  const rightFloatA = loopWave(frame, 1, Math.PI / 2) * 5;
  const rightFloatB = loopWave(frame, 1, Math.PI / 2 + 0.6) * 4;
  const rightFloatC = loopWave(frame, 1, Math.PI / 2 + 1.2) * 3;
  const pingScale = 1 + 0.08 * loopPulse(frame, 1, Math.PI / 2);
  const glowOpacity = 0.25 + 0.35 * loopPulse(frame, 1, Math.PI / 2);

  // --- small layered squares near the base: staggered breathing scale ---
  const sq1Scale = 0.92 + 0.08 * loopPulse(frame, 1, 0.3);
  const sq2Scale = 0.92 + 0.08 * loopPulse(frame, 1, 1.1);

  // --- progress bar near the base: soft loading pulse ---
  const barOpacity = 0.6 + 0.4 * loopPulse(frame, 2);

  // --- outline glow around the base edge ---
  const outlineOpacity = 0.18 + 0.22 * loopPulse(frame, 1);

  const cx = UPLOAD_ANIMATION_SIZE / 2;

  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      <svg
        viewBox={`0 0 ${UPLOAD_ANIMATION_SIZE} ${UPLOAD_ANIMATION_SIZE}`}
        width="100%"
        height="100%"
      >
        {/* faint outline "track" around the base, matches the platform footprint */}
        <rect
          x={70}
          y={300 + baseFloat}
          width={340}
          height={140}
          rx={18}
          fill="none"
          stroke={RED}
          strokeWidth={1.2}
          opacity={outlineOpacity}
        />

        {/* base assembly: moves together as one rigid unit, float only */}
        <g transform={`translate(0, ${baseFloat})`}>
          {/* bottom slab */}
          <IsoSlab
            cx={cx}
            topY={318}
            halfW={128}
            halfH={40}
            depth={18}
            topFill="#fafafa"
            leftFill={GREY_LINE_SOFT}
            rightFill="#cfc9c8"
            edge="#bdb7b6"
          />
          {/* top slab (document stands on this) */}
          <IsoSlab
            cx={cx}
            topY={296}
            halfW={92}
            halfH={28}
            depth={14}
            topFill="#ffffff"
            leftFill={RED_FIXED}
            rightFill={RED_SOFT}
            edge={RED}
          />

          {/* small layered data squares, left of the platform */}
          <g transform={`translate(${cx - 108}, 328)`}>
            <rect
              x={-13}
              y={-13}
              width={26}
              height={26}
              rx={4}
              fill={RED}
              opacity={0.55}
              transform={`scale(${sq1Scale})`}
            />
            <rect
              x={-5}
              y={-3}
              width={26}
              height={26}
              rx={4}
              fill={RED_FIXED_DIM}
              opacity={0.85}
              transform={`scale(${sq2Scale})`}
            />
          </g>

          {/* progress bar, right of the platform */}
          <rect
            x={cx + 58}
            y={330}
            width={70}
            height={7}
            rx={3.5}
            fill={RED}
            opacity={barOpacity}
          />
        </g>

        {/* central document + arrow, standing on the base, base-float applied too */}
        <g transform={`translate(0, ${baseFloat})`}>
          {/* document */}
          <g transform={`translate(${cx}, 205)`}>
            <path
              d="M -35,-65 L 20,-65 L 35,-50 L 35,65 L -35,65 Z"
              fill="#ffffff"
              stroke={RED}
              strokeWidth={2.5}
            />
            {/* dog-ear fold */}
            <path d="M 20,-65 L 20,-50 L 35,-50 Z" fill={RED_FIXED} stroke={RED} strokeWidth={1.5} />

            {/* top checkmark, bold */}
            <path
              d="M -18,-38 L -8,-28 L 14,-50"
              fill="none"
              stroke={RED}
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* four cascading rows */}
            {[0, 1, 2, 3].map((i) => {
              const y = -8 + i * 20;
              const glow = rowGlow(i);
              return (
                <g key={i} opacity={0.55 + 0.45 * glow}>
                  <path
                    d={`M -22,${y} L -16,${y + 6} L -4,${y - 8}`}
                    fill="none"
                    stroke={RED}
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <rect x={2} y={y - 3} width={26} height={4} rx={2} fill={GREY_LINE} />
                </g>
              );
            })}
          </g>

          {/* falling arrow */}
          <g transform={`translate(${cx}, ${130 + arrowY})`} opacity={arrowOpacity}>
            <rect x={-9} y={-30} width={18} height={38} rx={4} fill={RED} />
            <path d="M -22,4 L 0,32 L 22,4 Z" fill={RED} />
            <circle cx={0} cy={-34} r={4} fill="#ffffff" opacity={0.9} />
          </g>

          {/* landing ripple, on the top slab */}
          <ellipse
            cx={cx}
            cy={272}
            rx={70 * rippleScale}
            ry={16 * rippleScale}
            fill="none"
            stroke={RED}
            strokeWidth={2}
            opacity={rippleOpacity}
          />
        </g>

        {/* left: browser window card, stacked duplicates behind */}
        <g transform={`translate(120, ${190 + leftFloat}) rotate(-7)`}>
          <rect x={-56} y={-8} width={112} height={78} rx={8} fill={RED_FIXED} opacity={0.35} transform="translate(-10,-10)" />
          <rect x={-56} y={-8} width={112} height={78} rx={8} fill={RED_FIXED_DIM} opacity={0.5} transform="translate(-4,-4)" />
          <rect x={-56} y={-8} width={112} height={78} rx={8} fill="#ffffff" stroke="#e3dedd" strokeWidth={1.5} />
          <rect x={-56} y={-8} width={112} height={16} rx={8} fill={RED} />
          <circle cx={-44} cy={0} r={3} opacity={0.5 + 0.5 * dot1} fill="#ffffff" />
          <circle cx={-34} cy={0} r={3} opacity={0.5 + 0.5 * dot2} fill="#ffffff" />
          <circle cx={-24} cy={0} r={3} opacity={0.5 + 0.5 * dot3} fill="#ffffff" />
          <rect x={-44} y={20} width={80} height={6} rx={3} fill={GREY_LINE} opacity={shimmer} />
          <rect x={-44} y={34} width={64} height={6} rx={3} fill={GREY_LINE} opacity={shimmer} />
          <rect x={-44} y={48} width={72} height={6} rx={3} fill={GREY_LINE_SOFT} opacity={shimmer} />
        </g>

        {/* right: notification / chat stack, fanned duplicates behind */}
        <g transform={`translate(360, ${185 + rightFloatC})`}>
          <rect x={-46} y={20} width={92} height={66} rx={10} fill={RED_FIXED} opacity={0.4} transform="translate(10,8)" />
          <g transform={`translate(0, ${rightFloatB - rightFloatC})`}>
            <rect x={-46} y={10} width={92} height={66} rx={10} fill={RED_FIXED_DIM} opacity={0.55} transform="translate(5,4)" />
          </g>
          <g transform={`translate(0, ${rightFloatA - rightFloatC})`}>
            <rect
              x={-50}
              y={-6}
              width={100}
              height={30}
              rx={14}
              fill={RED}
              opacity={glowOpacity}
              transform={`scale(${pingScale})`}
            />
            <rect x={-46} y={-2} width={92} height={22} rx={11} fill="#ffffff" stroke={RED} strokeWidth={2} />
            <circle cx={-30} cy={9} r={2.5} fill={RED} />
            <circle cx={-22} cy={9} r={2.5} fill={RED} />
            <circle cx={-14} cy={9} r={2.5} fill={RED} />
          </g>
          <rect x={-40} y={38} width={72} height={6} rx={3} fill={GREY_LINE} />
          <rect x={-40} y={52} width={56} height={6} rx={3} fill={GREY_LINE_SOFT} />
          <rect x={-40} y={66} width={64} height={6} rx={3} fill={GREY_LINE_SOFT} />
        </g>
      </svg>
    </AbsoluteFill>
  );
};

function IsoSlab({
  cx,
  topY,
  halfW,
  halfH,
  depth,
  topFill,
  leftFill,
  rightFill,
  edge,
}: {
  cx: number;
  topY: number;
  halfW: number;
  halfH: number;
  depth: number;
  topFill: string;
  leftFill: string;
  rightFill: string;
  edge: string;
}) {
  const top = { x: cx, y: topY };
  const right = { x: cx + halfW, y: topY + halfH };
  const bottom = { x: cx, y: topY + 2 * halfH };
  const left = { x: cx - halfW, y: topY + halfH };

  return (
    <g>
      <path
        d={`M ${left.x},${left.y} L ${bottom.x},${bottom.y} L ${bottom.x},${bottom.y + depth} L ${left.x},${left.y + depth} Z`}
        fill={leftFill}
        stroke={edge}
        strokeWidth={1}
      />
      <path
        d={`M ${bottom.x},${bottom.y} L ${right.x},${right.y} L ${right.x},${right.y + depth} L ${bottom.x},${bottom.y + depth} Z`}
        fill={rightFill}
        stroke={edge}
        strokeWidth={1}
      />
      <path
        d={`M ${top.x},${top.y} L ${right.x},${right.y} L ${bottom.x},${bottom.y} L ${left.x},${left.y} Z`}
        fill={topFill}
        stroke={edge}
        strokeWidth={1}
      />
    </g>
  );
}
