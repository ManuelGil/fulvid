/**
 * Window frame persistence for the Bun host process.
 * Intent only - size and position, not view state.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Utils } from "electrobun/main";

type WindowFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const DEFAULT_FRAME: WindowFrame = {
  width: 1400,
  height: 900,
  x: 200,
  y: 100,
};

const MIN_WIDTH = 960;
const MIN_HEIGHT = 640;

function boundsPath(): string {
  const dir = Utils.paths.userData;
  mkdirSync(dir, { recursive: true });
  return join(dir, "window-frame.json");
}

function roundedOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
}

function sanitize(value: unknown): WindowFrame {
  const source = value && typeof value === "object" ? (value as Partial<WindowFrame>) : {};
  return {
    x: roundedOr(source.x, DEFAULT_FRAME.x),
    y: roundedOr(source.y, DEFAULT_FRAME.y),
    // The defaults already exceed the minimums, so clamping them is a no-op.
    width: Math.max(MIN_WIDTH, roundedOr(source.width, DEFAULT_FRAME.width)),
    height: Math.max(MIN_HEIGHT, roundedOr(source.height, DEFAULT_FRAME.height)),
  };
}

export function loadWindowFrame(): WindowFrame {
  try {
    const raw = readFileSync(boundsPath(), "utf8");
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_FRAME };
  }
}

export function saveWindowFrame(frame: WindowFrame): void {
  try {
    writeFileSync(boundsPath(), JSON.stringify(sanitize(frame)));
  } catch (error) {
    console.warn("Could not persist window frame:", error);
  }
}
