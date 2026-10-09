import React from "react";
import { Composition, Folder } from "remotion";
import { FPS, H, W } from "./kit";
import { Demo, DEMO_FRAMES, DEMO_H, DEMO_W } from "./Demo";
import { Promo, SCENES, TOTAL_FRAMES } from "./Promo";

export const RemotionRoot: React.FC = () => (
  <>
    <Folder name="Promo-Scenes">
      {SCENES.map(({ id, component, durationInFrames }) => (
        <Composition key={id} id={id} component={component} width={W} height={H} fps={FPS} durationInFrames={durationInFrames} />
      ))}
    </Folder>
    <Composition id="PromptGuardPromo" component={Promo} width={W} height={H} fps={FPS} durationInFrames={TOTAL_FRAMES} />
    <Composition id="PromptGuardDemo" component={Demo} width={DEMO_W} height={DEMO_H} fps={FPS} durationInFrames={DEMO_FRAMES} />
  </>
);
