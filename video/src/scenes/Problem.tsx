import React from "react";
import { useCurrentFrame } from "remotion";
import { Caption, COLORS, enter, Hi, pop, Scene } from "../kit";

const WORDS = ["Names.", "TIN numbers.", "Passwords."];

/** What just left the building. */
export const Problem: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Scene>
      {WORDS.map((word, i) => (
        <Caption key={word} top={330 + i * 220} size={132} style={pop(frame, 4 + i * 14)}>
          {word}
        </Caption>
      ))}
      <Caption top={1120} size={84} style={enter(frame, 52)}>
        Now sitting on <Hi color={COLORS.red}>someone else&apos;s server</Hi>.
      </Caption>
      <Caption top={1480} size={64} style={{ ...enter(frame, 66), fontWeight: 700, WebkitTextStroke: "0px" }}>
        Banning AI tools doesn&apos;t work. People paste anyway.
      </Caption>
    </Scene>
  );
};
