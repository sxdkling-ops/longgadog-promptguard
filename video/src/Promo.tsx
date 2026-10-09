import React from "react";
import { Audio } from "@remotion/media";
import { Sequence, Series, staticFile } from "remotion";
import { Blocked } from "./scenes/Blocked";
import { Everywhere } from "./scenes/Everywhere";
import { Hook } from "./scenes/Hook";
import { Local } from "./scenes/Local";
import { Meet } from "./scenes/Meet";
import { Outro } from "./scenes/Outro";
import { PasteDemo } from "./scenes/PasteDemo";
import { Problem } from "./scenes/Problem";
import { TIMING } from "./timing";
import { Email } from "./scenes/Email";
import { Files } from "./scenes/Files";
import { Strict } from "./scenes/Strict";
import { TypeDemo } from "./scenes/TypeDemo";

/** Scene order. The lengths here are fallbacks: make-voiceover.py writes the real ones, fitted to the voice, to timing.ts. */
const BASE = [
  { id: "Hook", component: Hook, durationInFrames: 120, voice: "01-hook" },
  { id: "Problem", component: Problem, durationInFrames: 120, voice: "02-problem" },
  { id: "Meet", component: Meet, durationInFrames: 120, voice: "03-meet" },
  { id: "PasteDemo", component: PasteDemo, durationInFrames: 210, voice: "04-paste" },
  { id: "TypeDemo", component: TypeDemo, durationInFrames: 165, voice: "05-type" },
  { id: "Blocked", component: Blocked, durationInFrames: 165, voice: "06-blocked" },
  { id: "Files", component: Files, durationInFrames: 165, voice: "07-files" },
  { id: "Email", component: Email, durationInFrames: 150, voice: "08-email" },
  { id: "Local", component: Local, durationInFrames: 165, voice: "09-local" },
  { id: "Strict", component: Strict, durationInFrames: 135, voice: "10-strict" },
  { id: "Everywhere", component: Everywhere, durationInFrames: 135, voice: "11-everywhere" },
  { id: "Outro", component: Outro, durationInFrames: 150, voice: "12-outro" },
] as const;

export const SCENES = BASE.map((scene) => ({ ...scene, durationInFrames: TIMING[scene.id] ?? scene.durationInFrames }));

export const TOTAL_FRAMES = SCENES.reduce((sum, scene) => sum + scene.durationInFrames, 0);

export const Promo: React.FC = () => (
  <Series>
    {SCENES.map(({ id, component: SceneComponent, durationInFrames, voice }) => (
      <Series.Sequence key={id} name={id} durationInFrames={durationInFrames}>
        <SceneComponent />
        {/* Voiceover line for this scene, made by make-voiceover.py. It starts a moment after the cut. */}
        <Sequence from={6} layout="none" name="Voiceover">
          <Audio src={staticFile(`vo/${voice}.wav`)} />
        </Sequence>
      </Series.Sequence>
    ))}
  </Series>
);
