/**
 * Production decorations capability contract (Extension API v1).
 *
 * Explicit guest surface (requires capability `decorations` + `lua`):
 *   - decorations.set(ranges) -> queues host-owned Monaco decorations
 *   - decorations.clear() -> queues clear of this extension's decorations
 *
 * Closed host `style` tokens only (visual primitives, not product semantics).
 * Extensions map their own meaning onto these styles. Apply uses document
 * identity stamps (reject stale). Command-driven refresh only - no keystroke
 * auto-refresh.
 */
import { LUA_EXTENSION_LIMITS } from "../../bun/extensions/lua/luaLimits";

/** Generic visual styles any extension may request. No product semantics. */
export const EXTENSION_DECORATION_STYLES = ["info", "warn", "error"] as const;

export type ExtensionDecorationStyle = (typeof EXTENSION_DECORATION_STYLES)[number];

const STYLE_SET = new Set<string>(EXTENSION_DECORATION_STYLES);

export const DECORATION_EXTENSION_LIMITS = {
  maxRanges: LUA_EXTENSION_LIMITS.maxDecorationRanges,
} as const;

export type ExtensionDecorationRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  style: ExtensionDecorationStyle;
};

export type DecorationsMutationRequest = {
  clear?: boolean;
  set?: ExtensionDecorationRange[];
};

export function cssClassForExtensionDecoration(style: ExtensionDecorationStyle): string {
  return `fulvid-ext-decoration-${style}`;
}

/** Validate a decorations.set payload. */
export function parseExtensionDecorationRanges(
  value: unknown,
): { ok: true; ranges: ExtensionDecorationRange[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "decorations.set requires an array" };
  }
  if (value.length > DECORATION_EXTENSION_LIMITS.maxRanges.value) {
    return { ok: false, error: "decorations.set exceeds range limit" };
  }
  const ranges: ExtensionDecorationRange[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { ok: false, error: "decoration range must be an object" };
    }
    const record = entry as Record<string, unknown>;
    const { startLine, startColumn, endLine, endColumn, style } = record;
    const maxPos = LUA_EXTENSION_LIMITS.maxRevealPosition.value;
    if (
      typeof startLine !== "number" ||
      typeof startColumn !== "number" ||
      typeof endLine !== "number" ||
      typeof endColumn !== "number" ||
      !Number.isInteger(startLine) ||
      !Number.isInteger(startColumn) ||
      !Number.isInteger(endLine) ||
      !Number.isInteger(endColumn) ||
      startLine < 1 ||
      startColumn < 1 ||
      endLine < 1 ||
      endColumn < 1 ||
      startLine > maxPos ||
      startColumn > maxPos ||
      endLine > maxPos ||
      endColumn > maxPos
    ) {
      return { ok: false, error: "invalid decoration range" };
    }
    if (typeof style !== "string" || !STYLE_SET.has(style)) {
      return { ok: false, error: `unknown decoration style: ${String(style)}` };
    }
    ranges.push({
      startLine,
      startColumn,
      endLine,
      endColumn,
      style: style as ExtensionDecorationStyle,
    });
  }
  return { ok: true, ranges };
}
