/**
 * Generic extension template render (Extension API v1).
 *
 * Capability `templates` exposes Lua `template.render(source, variables)`.
 * Substitutes `{{name}}` only - no sections, partials, unescaped HTML, lambdas,
 * filesystem, dates, or product-domain variable factories.
 *
 * Callers (packs) own all semantic variable names and defaults.
 */
import Mustache from "mustache";

import { EXTENSION_PACK_LIMITS } from "../../../mainview/extensions/extensionManifest";

export const EXTENSION_TEMPLATE_LIMITS = {
  /** Max UTF-16 code units for the template source string. */
  maxTemplateChars: EXTENSION_PACK_LIMITS.maxTemplateBytes,
  /** Max UTF-16 code units for the rendered output. */
  maxOutputChars: EXTENSION_PACK_LIMITS.maxTemplateBytes,
  maxVariables: 64,
  maxVariableKeyChars: 64,
  maxVariableValueChars: 8 * 1024,
} as const;

const VARIABLE_KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/** Reject Mustache features beyond plain escaped interpolation. */
const FORBIDDEN_MUSTACHE = /\{\{\s*[#^/>&{!]|\{\{\{/;

export type ExtensionTemplateVariables = Readonly<Record<string, string>>;

export type ExtensionTemplateRenderResult =
  { ok: true; text: string } | { ok: false; error: string };

/**
 * Parse a guest variables table into string→string only.
 * Rejects nested tables, functions, and non-string scalars.
 */
export function parseExtensionTemplateVariables(
  value: unknown,
): { ok: true; variables: ExtensionTemplateVariables } | { ok: false; error: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "template variables must be a table of strings" };
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => !/^\d+$/.test(key));
  if (keys.length > EXTENSION_TEMPLATE_LIMITS.maxVariables) {
    return { ok: false, error: "template variable count exceeds limit" };
  }
  const variables: Record<string, string> = {};
  for (const key of keys) {
    if (
      key.length === 0 ||
      key.length > EXTENSION_TEMPLATE_LIMITS.maxVariableKeyChars ||
      !VARIABLE_KEY.test(key)
    ) {
      return { ok: false, error: "invalid template variable key" };
    }
    const entry = record[key];
    if (typeof entry !== "string") {
      return { ok: false, error: "template variable values must be strings" };
    }
    if (entry.length > EXTENSION_TEMPLATE_LIMITS.maxVariableValueChars) {
      return { ok: false, error: "template variable value exceeds size limit" };
    }
    variables[key] = entry;
  }
  return { ok: true, variables };
}

/**
 * Render `source` with escaped `{{name}}` substitutions.
 * Missing keys become empty strings. No executable template behavior.
 */
export function renderExtensionTemplate(
  source: unknown,
  variablesInput: unknown,
): ExtensionTemplateRenderResult {
  if (typeof source !== "string") {
    return { ok: false, error: "template source must be a string" };
  }
  if (source.length > EXTENSION_TEMPLATE_LIMITS.maxTemplateChars) {
    return { ok: false, error: "template source exceeds size limit" };
  }
  if (FORBIDDEN_MUSTACHE.test(source)) {
    return { ok: false, error: "template syntax not allowed" };
  }
  const parsed = parseExtensionTemplateVariables(variablesInput);
  if (!parsed.ok) {
    return parsed;
  }
  // Disable Mustache HTML entity decoding of tags we already rejected.
  const text = Mustache.render(source, parsed.variables, undefined, ["{{", "}}"]);
  if (text.length > EXTENSION_TEMPLATE_LIMITS.maxOutputChars) {
    return { ok: false, error: "template output exceeds size limit" };
  }
  return { ok: true, text };
}
