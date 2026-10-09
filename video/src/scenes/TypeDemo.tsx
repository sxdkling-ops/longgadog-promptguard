import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Dog } from "../Dog";
import { Bubble, Caption, Card, Chip, COLORS, enter, Hi, Label, MONO, pop, Scene } from "../kit";

const TYPED = "Username (Admin): jdelacruz   Password: Tr0ub4dor&3";
const SWAP = 96; // the user pauses, and the guard steps in

/** Typing guard: in the browser, a password is replaced about a second after you stop typing. Made-up credentials. */
export const TypeDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const shown = Math.round(interpolate(frame, [20, 80], [0, TYPED.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const swapped = frame >= SWAP;
  return (
    <Scene>
      <Caption top={130} size={88} style={enter(frame, 0)}>
        Typed a <Hi>password</Hi>? It&apos;s gone before you hit send.
      </Caption>

      <Card style={{ position: "absolute", left: 70, right: 70, top: 640, ...enter(frame, 10, 100) }}>
        <Label>Typing in the chatbot</Label>
        <div style={{ fontFamily: MONO, fontSize: 38, minHeight: 130, lineHeight: 1.5 }}>
          {swapped ? (
            <>
              Username (Admin): <Chip>[USERNAME_1]</Chip>
              <br />
              Password: <Chip tone="red">[SECRET_REMOVED]</Chip>
            </>
          ) : (
            <>
              {TYPED.slice(0, shown)}
              <span style={{ opacity: Math.floor(frame / 8) % 2 ? 0 : 1 }}>|</span>
            </>
          )}
        </div>
      </Card>

      <div style={{ position: "absolute", left: 600, top: 1380, ...pop(frame, 16) }}>
        <Dog size={420} mood={swapped ? "angry" : "idle"} lookX={-0.6} lookY={-0.8} />
      </div>
      {swapped ? <Bubble title="WOOF!" text="2 items replaced as you typed" angry style={{ left: 70, top: 1250, width: 580, ...pop(frame, SWAP) }} /> : null}
      <Caption top={1010} size={50} style={{ ...enter(frame, SWAP + 14), fontWeight: 700, WebkitTextStroke: "0px", color: COLORS.teal }}>
        In the browser, with the LonggaDog sensor
      </Caption>
    </Scene>
  );
};
