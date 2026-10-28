"use client";
import type { ReactNode } from "react";
import { DemoProvider } from "./controller";
import { DemoCompletion } from "./launcher";
import { DemoSpotlight } from "./spotlight";
import { DemoStage } from "./stage";
import { DemoStoryPanel } from "./story-panel";

/** Mounted once in the root layout so the walkthrough survives client-side route changes. */
export function DemoRoot({ children }: { children: ReactNode }) {
  return (
    <DemoProvider>
      {children}
      <DemoSpotlight />
      <DemoStage />
      <DemoStoryPanel />
      <DemoCompletion />
    </DemoProvider>
  );
}

export { DemoCta } from "./launcher";
export { useDemoInput } from "./controller";
