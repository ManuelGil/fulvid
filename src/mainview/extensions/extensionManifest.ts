/**
 * Extension manifest contract (Extension API v1).
 *
 * Packs declare capabilities and a relative `entry` Lua source. Commands are
 * registered from entry.lua at load time. Validation never executes Lua and
 * grants no filesystem/Monaco authority.
 */

export const EXTENSION_API_VERSION = 1;

/**
 * Pack-wide resource budgets.
 * Changing a value is a contract change - pin behavior in tests/extensions.
 */
export const EXTENSION_PACK_LIMITS = {
  /** Maximum UTF-8 byte length of manifest.json. */
  maxManifestBytes: 64 * 1024,
  /**
   * Maximum UTF-16 code units for `document.createUntitled` bodies.
   * Name retained for compatibility with existing limit wiring.
   */
  maxTemplateBytes: 256 * 1024,
  /** Maximum UTF-16 code units for notify messages. */
  maxNotifyMessageChars: 500,
} as const;

/**
 * Closed capability surface for Extension API v1.
 * Declaring a capability grants no resource. `lua` selects the host Wasm runtime.
 */
export const ALLOWED_EXTENSION_CAPABILITIES = [
  "commands",
  "ui",
  "lua",
  "editor",
  "document",
  "decorations",
] as const;

export type ExtensionCapability = (typeof ALLOWED_EXTENSION_CAPABILITIES)[number];

const FORBIDDEN_MANIFEST_KEYS = new Set([
  "main",
  "script",
  "scripts",
  "lua",
  "wasm",
  "module",
  "loader",
  "sandbox",
  "permissions",
  "filesystem",
  "network",
  "process",
  "monaco",
  "commands",
  "templates",
]);

/** `local.<name>` ids - fixtures and user packs share this shape. */
const EXTENSION_ID_PATTERN = /^local\.[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/;

export type ExtensionManifest = {
  id: string;
  name: string;
  version: string;
  api: number;
  description?: string;
  capabilities: ExtensionCapability[];
  /** Relative `.lua` source - required when capabilities include `lua`. */
  entry?: string;
};

/** Host->renderer DTO after discovery (commands come from Lua registration). */
export type DiscoveredExtensionCommand = {
  id: string;
  namespacedId: string;
  title: string;
};

export type DiscoveredExtension = {
  id: string;
  name: string;
  version: string;
  api: number;
  description?: string;
  capabilities: string[];
  commands: DiscoveredExtensionCommand[];
};

export type ExtensionLoadFailure = {
  id: string;
  reason: string;
};

export type ExtensionDiscoveryResult = {
  loaded: DiscoveredExtension[];
  failed: ExtensionLoadFailure[];
};

export type ManifestValidationFailure = {
  reason: string;
};

export type ManifestValidationSuccess = {
  manifest: ExtensionManifest;
};

export type ManifestValidationResult = ManifestValidationSuccess | ManifestValidationFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAllowedCapability(value: string): value is ExtensionCapability {
  return (ALLOWED_EXTENSION_CAPABILITIES as readonly string[]).includes(value);
}

export function isValidExtensionId(id: string): boolean {
  return EXTENSION_ID_PATTERN.test(id);
}

export function namespacedExtensionCommandId(extensionId: string, commandId: string): string {
  return `${extensionId}.${commandId}`;
}

/**
 * Validate a parsed JSON value as an Extension API v1 manifest.
 * Returns a reason string on failure - never throws.
 */
export function validateExtensionManifest(value: unknown): ManifestValidationResult {
  if (!isRecord(value)) {
    return { reason: "manifest must be an object" };
  }

  for (const key of Object.keys(value)) {
    if (FORBIDDEN_MANIFEST_KEYS.has(key)) {
      return { reason: `forbidden manifest key: ${key}` };
    }
  }

  if (typeof value.id !== "string" || !isValidExtensionId(value.id)) {
    return { reason: "invalid extension id" };
  }
  if (typeof value.name !== "string" || value.name.trim().length === 0) {
    return { reason: "invalid extension name" };
  }
  if (typeof value.version !== "string" || value.version.trim().length === 0) {
    return { reason: "invalid extension version" };
  }
  if (typeof value.api !== "number" || !Number.isInteger(value.api)) {
    return { reason: "api must be an integer" };
  }
  if (value.api !== EXTENSION_API_VERSION) {
    return { reason: `unsupported api version: ${value.api}` };
  }
  if (!Array.isArray(value.capabilities) || value.capabilities.length === 0) {
    return { reason: "capabilities must be a non-empty array" };
  }

  const capabilities: ExtensionCapability[] = [];
  for (const capability of value.capabilities) {
    if (typeof capability !== "string" || !isAllowedCapability(capability)) {
      return { reason: `unknown capability: ${String(capability)}` };
    }
    capabilities.push(capability);
  }

  const capabilitySet = new Set(capabilities);
  const hasLua = capabilitySet.has("lua");

  let entry: string | undefined;
  if (value.entry !== undefined) {
    if (!hasLua) {
      return { reason: "entry requires the lua capability" };
    }
    if (typeof value.entry !== "string" || value.entry.trim().length === 0) {
      return { reason: "invalid entry path" };
    }
    const normalized = value.entry.replace(/\\/g, "/").trim();
    if (
      !normalized.endsWith(".lua") ||
      normalized.includes("\0") ||
      normalized.startsWith("/") ||
      /^[A-Za-z]:/.test(normalized)
    ) {
      return { reason: "entry must be a relative .lua source file" };
    }
    const entrySegments = normalized.split("/").filter((segment) => segment.length > 0);
    if (
      entrySegments.length === 0 ||
      entrySegments.some((segment) => segment === "." || segment === "..")
    ) {
      return { reason: "entry must be a relative .lua source file" };
    }
    entry = normalized;
  } else if (hasLua) {
    return { reason: "lua capability requires entry" };
  }

  if (hasLua && !capabilitySet.has("commands")) {
    return { reason: "lua capability requires the commands capability" };
  }
  if (hasLua && !capabilitySet.has("ui")) {
    return { reason: "lua capability requires the ui capability" };
  }
  if (capabilitySet.has("editor") && !hasLua) {
    return { reason: "editor capability requires the lua capability" };
  }
  if (capabilitySet.has("document") && !hasLua) {
    return { reason: "document capability requires the lua capability" };
  }
  if (capabilitySet.has("decorations") && !hasLua) {
    return { reason: "decorations capability requires the lua capability" };
  }
  if (capabilitySet.has("commands") && !hasLua) {
    return { reason: "commands capability requires the lua capability" };
  }

  const manifest: ExtensionManifest = {
    id: value.id,
    name: value.name,
    version: value.version,
    api: value.api,
    capabilities,
  };
  if (typeof value.description === "string") {
    manifest.description = value.description;
  }
  if (entry !== undefined) {
    manifest.entry = entry;
  }

  return { manifest };
}
