/**
 * Extension manifest contract (Extension API v1).
 *
 * Packs declare capabilities and a relative `entry` Lua source. Commands are
 * registered from entry.lua at load time. Validation never executes Lua and
 * grants no filesystem/Monaco authority.
 *
 * Optional presentation metadata (`activation`, `actions`, `documentAction`)
 * places approved actions into existing Fulvid menus and marks document-oriented
 * packs for host-driven always-on refresh - not a plugin framework.
 */

export const EXTENSION_API_VERSION = 1;

/**
 * Closed set of Fulvid menu targets where extension actions may appear.
 * Invalid targets fail closed at manifest validation.
 */
export const EXTENSION_MENU_TARGETS = ["file.new", "edit", "view", "navigate", "help"] as const;

export type ExtensionMenuTarget = (typeof EXTENSION_MENU_TARGETS)[number];

/** How the pack participates after a successful preload. */
export const EXTENSION_ACTIVATIONS = ["command", "document", "startup"] as const;

export type ExtensionActivation = (typeof EXTENSION_ACTIVATIONS)[number];

export type ExtensionActionPlacement = {
  /** Must match a Lua-registered command id after preload. */
  id: string;
  /** Existing Fulvid menu target; omit to hide from menus (e.g. document refresh). */
  menu?: ExtensionMenuTarget;
  /** Lower sorts earlier within the same menu target. */
  order?: number;
  /** Optional menu label; otherwise the Lua command title is used. */
  title?: string;
};

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
  /** Generic `template.render(source, vars)` - no product-domain variables. */
  "templates",
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
  author?: string;
  capabilities: ExtensionCapability[];
  /** Relative `.lua` source - required when capabilities include `lua`. */
  entry?: string;
  /** Defaults to `command` when omitted. */
  activation?: ExtensionActivation;
  /**
   * Lua command id auto-invoked (silently) when the active document changes.
   * Required when `activation` is `document`.
   */
  documentAction?: string;
  /** Declarative menu placement for registered Lua commands. */
  actions?: ExtensionActionPlacement[];
};

/** Host->renderer DTO after discovery (commands come from Lua registration). */
export type DiscoveredExtensionCommand = {
  id: string;
  namespacedId: string;
  title: string;
  menu?: ExtensionMenuTarget;
  order?: number;
  /** True when this command is the document always-on action (not a menu item). */
  documentAction?: boolean;
};

export type ExtensionLoadState = "loaded" | "blocked" | "failed" | "allowed";

export type DiscoveredExtension = {
  id: string;
  name: string;
  version: string;
  api: number;
  description?: string;
  author?: string;
  capabilities: string[];
  commands: DiscoveredExtensionCommand[];
  /** Absolute pack directory under userData/extensions (host-owned path). */
  location: string;
  state: ExtensionLoadState;
  /** Bounded reason when blocked or failed. */
  reason?: string;
  activation: ExtensionActivation;
  documentAction?: string;
};

export type ExtensionLoadFailure = {
  id: string;
  reason: string;
};

export type ExtensionDiscoveryResult = {
  loaded: DiscoveredExtension[];
  /** Blocked or failed packs (unloaded). Kept for Settings / consent. */
  failed: ExtensionLoadFailure[];
  /** Full install inventory including blocked/failed (Settings presentation). */
  installed: DiscoveredExtension[];
  /** Absolute userData/extensions root. */
  extensionsRoot: string | null;
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

function isAllowedMenuTarget(value: string): value is ExtensionMenuTarget {
  return (EXTENSION_MENU_TARGETS as readonly string[]).includes(value);
}

function isAllowedActivation(value: string): value is ExtensionActivation {
  return (EXTENSION_ACTIVATIONS as readonly string[]).includes(value);
}

const ACTION_ID_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

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
  if (capabilitySet.has("templates") && !hasLua) {
    return { reason: "templates capability requires the lua capability" };
  }
  if (capabilitySet.has("commands") && !hasLua) {
    return { reason: "commands capability requires the lua capability" };
  }

  let activation: ExtensionActivation = "command";
  if (value.activation !== undefined) {
    if (typeof value.activation !== "string" || !isAllowedActivation(value.activation)) {
      return { reason: "invalid activation" };
    }
    activation = value.activation;
  }

  let documentAction: string | undefined;
  if (value.documentAction !== undefined) {
    if (typeof value.documentAction !== "string" || !ACTION_ID_PATTERN.test(value.documentAction)) {
      return { reason: "invalid documentAction" };
    }
    documentAction = value.documentAction;
  }
  if (activation === "document" && !documentAction) {
    return { reason: "document activation requires documentAction" };
  }
  if (documentAction && activation !== "document") {
    return { reason: "documentAction requires document activation" };
  }

  let actions: ExtensionActionPlacement[] | undefined;
  if (value.actions !== undefined) {
    if (!Array.isArray(value.actions)) {
      return { reason: "actions must be an array" };
    }
    if (value.actions.length > 16) {
      return { reason: "too many actions" };
    }
    const seenActionIds = new Set<string>();
    actions = [];
    for (const rawAction of value.actions) {
      if (!isRecord(rawAction)) {
        return { reason: "invalid action" };
      }
      if (typeof rawAction.id !== "string" || !ACTION_ID_PATTERN.test(rawAction.id)) {
        return { reason: "invalid action id" };
      }
      if (seenActionIds.has(rawAction.id)) {
        return { reason: `duplicate action id: ${rawAction.id}` };
      }
      seenActionIds.add(rawAction.id);
      const placement: ExtensionActionPlacement = { id: rawAction.id };
      if (rawAction.menu !== undefined) {
        if (typeof rawAction.menu !== "string" || !isAllowedMenuTarget(rawAction.menu)) {
          return {
            reason:
              typeof rawAction.menu === "string"
                ? `invalid menu target: ${rawAction.menu}`
                : "invalid menu target",
          };
        }
        placement.menu = rawAction.menu;
      }
      if (rawAction.order !== undefined) {
        if (
          typeof rawAction.order !== "number" ||
          !Number.isInteger(rawAction.order) ||
          rawAction.order < 0 ||
          rawAction.order > 10_000
        ) {
          return { reason: "invalid action order" };
        }
        placement.order = rawAction.order;
      }
      if (rawAction.title !== undefined) {
        if (typeof rawAction.title !== "string" || rawAction.title.trim().length === 0) {
          return { reason: "invalid action title" };
        }
        if (rawAction.title.length > 200) {
          return { reason: "action title exceeds size limit" };
        }
        placement.title = rawAction.title.trim();
      }
      actions.push(placement);
    }
  }

  if (value.author !== undefined) {
    if (typeof value.author !== "string" || value.author.trim().length === 0) {
      return { reason: "invalid author" };
    }
    if (value.author.length > 200) {
      return { reason: "author exceeds size limit" };
    }
  }

  const manifest: ExtensionManifest = {
    id: value.id,
    name: value.name,
    version: value.version,
    api: value.api,
    capabilities,
    activation,
  };
  if (typeof value.description === "string") {
    manifest.description = value.description;
  }
  if (typeof value.author === "string") {
    manifest.author = value.author.trim();
  }
  if (entry !== undefined) {
    manifest.entry = entry;
  }
  if (documentAction !== undefined) {
    manifest.documentAction = documentAction;
  }
  if (actions !== undefined) {
    manifest.actions = actions;
  }

  return { manifest };
}
