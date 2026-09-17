/**
 * Decoration capability: packs choose style or appearance; Fulvid paints safely.
 * Guests never send CSS. Stale document stamps reject apply.
 */
import { LUA_EXTENSION_LIMITS } from "../../bun/extensions/lua/luaLimits";

/** Generic severity tokens. No product marker semantics. */
export const EXTENSION_DECORATION_STYLES = ["info", "warn", "error"] as const;

export type ExtensionDecorationStyle = (typeof EXTENSION_DECORATION_STYLES)[number];

const STYLE_SET = new Set<string>(EXTENSION_DECORATION_STYLES);

export const DECORATION_EXTENSION_LIMITS = {
  maxRanges: LUA_EXTENSION_LIMITS.maxDecorationRanges,
  maxColorChars: 32,
} as const;

/** Extension-owned paint data. Validated; never treated as a CSS stylesheet. */
export type ExtensionDecorationAppearance = {
  backgroundColor: string;
  color?: string;
  bold?: boolean;
  /** Defaults to backgroundColor. */
  overviewColor?: string;
  /** Defaults to true. */
  glyph?: boolean;
};

export type ExtensionDecorationRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  /** Generic host severity chip. Mutually exclusive with `appearance`. */
  style?: ExtensionDecorationStyle;
  /** Extension-owned colors. Mutually exclusive with `style`. */
  appearance?: ExtensionDecorationAppearance;
};

export type DecorationsMutationRequest = {
  clear?: boolean;
  set?: ExtensionDecorationRange[];
};

/** Hex paints Monaco's overview ruler accepts for closed style tokens. */
export const EXTENSION_DECORATION_OVERVIEW_HEX = {
  info: "#4a7fc4",
  warn: "#d29922",
  error: "#ff7b72",
} as const;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGBA_COLOR =
  /^rgba\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*(0|1|0?\.[0-9]+)\s*\)$/;

/** Accept only plain hex / rgba - reject urls, expressions, and CSS escapes. */
export function parseDecorationColor(
  value: unknown,
): { ok: true; color: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "decoration color must be a string" };
  }
  const color = value.trim();
  if (color.length === 0 || color.length > DECORATION_EXTENSION_LIMITS.maxColorChars) {
    return { ok: false, error: "decoration color length invalid" };
  }
  if (/[;{}]|url\s*\(|expression\s*\(|javascript:|var\s*\(/i.test(color)) {
    return { ok: false, error: "decoration color rejected" };
  }
  if (HEX_COLOR.test(color)) {
    return { ok: true, color: color.toLowerCase() };
  }
  const rgba = RGBA_COLOR.exec(color);
  if (rgba) {
    const r = Number(rgba[1]);
    const g = Number(rgba[2]);
    const b = Number(rgba[3]);
    const a = Number(rgba[4]);
    if (r > 255 || g > 255 || b > 255 || a < 0 || a > 1) {
      return { ok: false, error: "decoration color out of range" };
    }
    return { ok: true, color: `rgba(${r}, ${g}, ${b}, ${a})` };
  }
  return { ok: false, error: "decoration color must be #rgb, #rrggbb, or rgba(...)" };
}

export function parseDecorationAppearance(
  value: unknown,
): { ok: true; appearance: ExtensionDecorationAppearance } | { ok: false; error: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "decoration appearance must be an object" };
  }
  const record = value as Record<string, unknown>;
  const background = parseDecorationColor(record.backgroundColor);
  if (!background.ok) {
    return background;
  }
  const appearance: ExtensionDecorationAppearance = {
    backgroundColor: background.color,
  };
  if (record.color !== undefined) {
    const foreground = parseDecorationColor(record.color);
    if (!foreground.ok) {
      return foreground;
    }
    appearance.color = foreground.color;
  }
  if (record.overviewColor !== undefined) {
    const overview = parseDecorationColor(record.overviewColor);
    if (!overview.ok) {
      return overview;
    }
    appearance.overviewColor = overview.color;
  }
  if (record.bold !== undefined) {
    if (typeof record.bold !== "boolean") {
      return { ok: false, error: "decoration appearance.bold must be boolean" };
    }
    appearance.bold = record.bold;
  }
  if (record.glyph !== undefined) {
    if (typeof record.glyph !== "boolean") {
      return { ok: false, error: "decoration appearance.glyph must be boolean" };
    }
    appearance.glyph = record.glyph;
  }
  return { ok: true, appearance };
}

export function cssClassForExtensionDecoration(style: ExtensionDecorationStyle): string {
  return `fulvid-ext-decoration-${style}`;
}

export function appearanceClassKey(appearance: ExtensionDecorationAppearance): string {
  const raw = [
    appearance.backgroundColor,
    appearance.color ?? "",
    appearance.bold ? "1" : "0",
    appearance.overviewColor ?? appearance.backgroundColor,
    appearance.glyph === false ? "0" : "1",
  ].join("|");
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function cssClassForExtensionAppearance(appearance: ExtensionDecorationAppearance): string {
  return `fulvid-ext-a-${appearanceClassKey(appearance)}`;
}

export function glyphClassForExtensionAppearance(
  appearance: ExtensionDecorationAppearance,
): string {
  return `${cssClassForExtensionAppearance(appearance)}-glyph`;
}

/**
 * Monaco options for a validated range. Prefer `appearance` when present.
 */
export function monacoDecorationOptionsForRange(range: ExtensionDecorationRange): {
  inlineClassName: string;
  glyphMarginClassName: string | undefined;
  overviewRulerColor: string;
} {
  if (range.appearance) {
    const glyph = range.appearance.glyph !== false;
    return {
      inlineClassName: cssClassForExtensionAppearance(range.appearance),
      glyphMarginClassName: glyph ? glyphClassForExtensionAppearance(range.appearance) : undefined,
      overviewRulerColor: range.appearance.overviewColor ?? range.appearance.backgroundColor,
    };
  }
  const style = range.style ?? "info";
  return {
    inlineClassName: cssClassForExtensionDecoration(style),
    glyphMarginClassName: `fulvid-ext-decoration-glyph-${style}`,
    overviewRulerColor: EXTENSION_DECORATION_OVERVIEW_HEX[style],
  };
}

const EXTENSION_DECORATION_STYLE_ELEMENT_ID = "fulvid-extension-decoration-styles";
const EXTENSION_APPEARANCE_STYLE_ELEMENT_ID = "fulvid-extension-appearance-styles";
const injectedAppearanceKeys = new Set<string>();

/**
 * Closed-token chip CSS (info/warn/error). Used by packs that opt into host
 * severity tokens rather than supplying their own appearance.
 */
export function ensureExtensionDecorationStyles(): void {
  if (typeof document === "undefined") {
    return;
  }
  if (document.getElementById(EXTENSION_DECORATION_STYLE_ELEMENT_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = EXTENSION_DECORATION_STYLE_ELEMENT_ID;
  style.textContent = `
.monaco-editor .fulvid-ext-decoration-info,
.fulvid-ext-decoration-info {
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  border-radius: 0.2rem;
  font-weight: 700 !important;
  padding: 0 0.12em;
  background-color: ${EXTENSION_DECORATION_OVERVIEW_HEX.info} !important;
  color: #ffffff !important;
}
.monaco-editor .fulvid-ext-decoration-warn,
.fulvid-ext-decoration-warn {
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  border-radius: 0.2rem;
  font-weight: 700 !important;
  padding: 0 0.12em;
  background-color: ${EXTENSION_DECORATION_OVERVIEW_HEX.warn} !important;
  color: #0d1117 !important;
}
.monaco-editor .fulvid-ext-decoration-error,
.fulvid-ext-decoration-error {
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  border-radius: 0.2rem;
  font-weight: 700 !important;
  padding: 0 0.12em;
  background-color: ${EXTENSION_DECORATION_OVERVIEW_HEX.error} !important;
  color: #0d1117 !important;
}
.fulvid-ext-decoration-glyph-info,
.fulvid-ext-decoration-glyph-warn,
.fulvid-ext-decoration-glyph-error {
  position: relative;
}
.fulvid-ext-decoration-glyph-info::before,
.fulvid-ext-decoration-glyph-warn::before,
.fulvid-ext-decoration-glyph-error::before {
  content: "";
  position: absolute;
  inset: 0;
  display: block;
  width: 0.45rem;
  height: 0.45rem;
  margin: auto;
  border-radius: 50%;
}
.fulvid-ext-decoration-glyph-info::before {
  background: ${EXTENSION_DECORATION_OVERVIEW_HEX.info};
}
.fulvid-ext-decoration-glyph-warn::before {
  background: ${EXTENSION_DECORATION_OVERVIEW_HEX.warn};
}
.fulvid-ext-decoration-glyph-error::before {
  background: ${EXTENSION_DECORATION_OVERVIEW_HEX.error};
}
`.trim();
  document.head.appendChild(style);
}

/**
 * Host-authored CSS for a validated appearance. Guests never supply CSS text.
 */
export function ensureExtensionAppearanceStyles(appearance: ExtensionDecorationAppearance): void {
  if (typeof document === "undefined") {
    return;
  }
  const key = appearanceClassKey(appearance);
  if (injectedAppearanceKeys.has(key)) {
    return;
  }
  let sheet = document.getElementById(
    EXTENSION_APPEARANCE_STYLE_ELEMENT_ID,
  ) as HTMLStyleElement | null;
  if (!sheet) {
    sheet = document.createElement("style");
    sheet.id = EXTENSION_APPEARANCE_STYLE_ELEMENT_ID;
    document.head.appendChild(sheet);
  }
  const className = cssClassForExtensionAppearance(appearance);
  const glyphClass = glyphClassForExtensionAppearance(appearance);
  const color = appearance.color ?? "#0d1117";
  const weight = appearance.bold === false ? "400" : "700";
  const overview = appearance.overviewColor ?? appearance.backgroundColor;
  const glyphRule =
    appearance.glyph === false
      ? ""
      : `
.${glyphClass} { position: relative; }
.${glyphClass}::before {
  content: "";
  position: absolute;
  inset: 0;
  display: block;
  width: 0.45rem;
  height: 0.45rem;
  margin: auto;
  border-radius: 50%;
  background: ${overview};
}
`;
  sheet.textContent += `
.monaco-editor .${className},
.${className} {
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  border-radius: 0.2rem;
  font-weight: ${weight} !important;
  padding: 0 0.12em;
  background-color: ${appearance.backgroundColor} !important;
  color: ${color} !important;
}
${glyphRule}
`;
  injectedAppearanceKeys.add(key);
}

/** Test helper: reset appearance CSS injection bookkeeping. */
export function resetExtensionAppearanceStylesForTests(): void {
  injectedAppearanceKeys.clear();
  if (typeof document !== "undefined") {
    document.getElementById(EXTENSION_APPEARANCE_STYLE_ELEMENT_ID)?.remove();
    document.getElementById(EXTENSION_DECORATION_STYLE_ELEMENT_ID)?.remove();
  }
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
    const { startLine, startColumn, endLine, endColumn, style, appearance } = record;
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
    const hasStyle = style !== undefined;
    const hasAppearance = appearance !== undefined;
    if (hasStyle === hasAppearance) {
      return {
        ok: false,
        error: "decoration range requires exactly one of style or appearance",
      };
    }
    if (hasStyle) {
      if (typeof style !== "string" || !STYLE_SET.has(style)) {
        return {
          ok: false,
          error: `unknown decoration style: ${typeof style === "string" ? style : typeof style}`,
        };
      }
      ranges.push({
        startLine,
        startColumn,
        endLine,
        endColumn,
        style: style as ExtensionDecorationStyle,
      });
      continue;
    }
    const parsedAppearance = parseDecorationAppearance(appearance);
    if (!parsedAppearance.ok) {
      return parsedAppearance;
    }
    ranges.push({
      startLine,
      startColumn,
      endLine,
      endColumn,
      appearance: parsedAppearance.appearance,
    });
  }
  return { ok: true, ranges };
}
