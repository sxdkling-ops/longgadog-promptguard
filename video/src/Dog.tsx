import React from "react";
import { useCurrentFrame } from "remotion";

type Mood = "idle" | "angry" | "happy";

/** The PromptGuard mascot: the same original character the desktop app draws, animated by frame. */
export const Dog: React.FC<{ size: number; mood?: Mood; lookX?: number; lookY?: number; style?: React.CSSProperties }> = ({
  size,
  mood = "idle",
  lookX = 0,
  lookY = 0,
  style,
}) => {
  const frame = useCurrentFrame();
  const angry = mood === "angry";
  const happy = mood === "happy";
  const wag = angry ? -14 : Math.sin(frame / (happy ? 1.4 : 6)) * (happy ? 16 : 11) + 2;
  const blink = !angry && frame % 110 > 104 ? 0.1 : angry ? 0.78 : 1;
  const yap = 0.75 + Math.abs(Math.sin(frame / 2.2)) * 0.4;
  const shakeX = angry ? Math.sin(frame * 1.9) * 5 : 0;
  const shakeY = angry ? -Math.abs(Math.sin(frame * 1.9)) * 6 : happy ? -Math.abs(Math.sin(frame / 4)) * 10 : 0;
  const ink = { stroke: "#3b1d0b", strokeWidth: 3, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

  return (
    <svg width={size} height={size} viewBox="0 0 200 200" style={{ overflow: "visible", translate: `${shakeX}px ${shakeY}px`, ...style }}>
      <g style={{ transformOrigin: "140px 152px", rotate: `${wag}deg` }}>
        <path {...ink} d="M136 156 q40 -2 36 -42 q-2 -12 -12 -8 q6 26 -26 34 z" fill="#b45309" />
      </g>
      <path {...ink} d="M58 197 q-12 -58 42 -62 q54 4 42 62 z" fill="#c2651a" />
      <path d="M100 150 q-20 6 -18 46 h36 q2 -40 -18 -46 z" fill="#fde7c3" />
      <ellipse {...ink} cx="80" cy="192" rx="15" ry="8" fill="#fde7c3" />
      <ellipse {...ink} cx="120" cy="192" rx="15" ry="8" fill="#fde7c3" />
      <g style={{ translate: `${lookX * 4}px ${lookY * 3}px` }}>
        <path {...ink} d="M64 50 q-34 -6 -36 34 q0 26 16 26 q12 0 14 -22 q2 -22 16 -30 z" fill="#8a3f0c" />
        <path {...ink} d="M136 50 q34 -6 36 34 q0 26 -16 26 q-12 0 -14 -22 q-2 -22 -16 -30 z" fill="#8a3f0c" />
        <ellipse {...ink} cx="100" cy="88" rx="52" ry="46" fill="#c2651a" />
        <path d="M100 60 q-34 18 -30 50 q30 26 60 0 q4 -32 -30 -50 z" fill="#fde7c3" />
        {[79, 121].map((cx) => (
          <g key={cx} style={{ transformOrigin: `${cx}px 84px`, scale: `1 ${blink}` }}>
            <ellipse {...ink} cx={cx} cy="84" rx="11" ry="13" fill="#fff" />
            <g style={{ translate: `${lookX * 4.5}px ${lookY * 4}px` }}>
              <circle cx={cx} cy="86" r="6.5" fill="#1f1305" />
              <circle cx={cx + 2.5} cy="83" r="2.2" fill="#fff" />
            </g>
          </g>
        ))}
        {angry ? <path d="M64 64 L92 75 M136 64 L108 75" stroke="#3b1d0b" strokeWidth="6.5" strokeLinecap="round" fill="none" /> : null}
        <ellipse cx="100" cy="103" rx="9.5" ry="6.5" fill="#1f1305" />
        {angry ? (
          <g style={{ transformOrigin: "100px 111px", scale: `1 ${yap}` }}>
            <path {...ink} d="M82 111 h36 q-4 26 -18 26 q-14 0 -18 -26 z" fill="#7f1d1d" />
            <path d="M88 112 l4 7 l4 -7 M104 112 l4 7 l4 -7" fill="#fff" stroke="#3b1d0b" strokeWidth="1.5" strokeLinejoin="round" />
          </g>
        ) : (
          <path {...ink} d="M85 113 q15 14 30 0" fill="none" strokeWidth={3.5} />
        )}
        {happy ? <path {...ink} d="M93 119 q7 16 14 0 z" fill="#f87171" strokeWidth={2.5} /> : null}
      </g>
      <path d="M70 130 q30 18 60 0" fill="none" stroke="#0f766e" strokeWidth="10" strokeLinecap="round" />
      <path d="M100 137 l9 4 v6 q0 7 -9 11 q-9 -4 -9 -11 v-6 z" fill="#99f6e4" stroke="#0f766e" strokeWidth="2.5" strokeLinejoin="round" />
      {angry ? (
        <g>
          <path d="M152 24 q8 -2 8 -10 M166 28 q2 -8 10 -8 M170 42 q8 2 8 10 M156 38 q-2 8 -10 8" stroke="#dc2626" strokeWidth="4.5" strokeLinecap="round" fill="none" />
          <path d="M22 96 L6 88 M22 110 L4 112 M24 124 L8 134 M178 96 L194 88 M178 110 L196 112 M176 124 L192 134" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" fill="none" />
        </g>
      ) : null}
    </svg>
  );
};
