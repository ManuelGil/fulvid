/**
 * Window frame persistence for the Bun host process.
 * Intent only - size and position, not view state.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Utils } from "electrobun/main";

export type WindowFrame = {
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

function sanitize(value: unknown): WindowFrame {
  const source = value && typeof value === "object" ? (value as Partial<WindowFrame>) : {};

  const width =
    typeof source.width === "number" && Number.isFinite(source.width)
      ? Math.max(MIN_WIDTH, Math.round(source.width))
      : DEFAULT_FRAME.width;
  const height =
    typeof source.height === "number" && Number.isFinite(source.height)
      ? Math.max(MIN_HEIGHT, Math.round(source.height))
      : DEFAULT_FRAME.height;
  const x =
    typeof source.x === "number" && Number.isFinite(source.x)
      ? Math.round(source.x)
      : DEFAULT_FRAME.x;
  const y =
    typeof source.y === "number" && Number.isFinite(source.y)
      ? Math.round(source.y)
      : DEFAULT_FRAME.y;

  return { x, y, width, height };
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
