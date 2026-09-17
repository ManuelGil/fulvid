/**
 * Extension manifest contract (Extension API v1).
 *
 * Canonical identity is `publisher.name` (e.g. `imgildev.todo-decorator`).
 * Installation source (official / third-party / local-dev) is separate from identity.
 *
 * Packs declare capabilities and a relative `entry` Lua source. Validation never
 * executes Lua and grants no filesystem/Monaco authority.
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

/** Human-facing author metadata (not an account). */
export type ExtensionAuthor =
  | string
  | {
      name: string;
      email?: string;
      url?: string;
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
   */
  maxTemplateBytes: 256 * 1024,
  /** Maximum UTF-16 code units for notify messages. */
  maxNotifyMessageChars: 500,
  maxDisplayNameChars: 80,
  maxDescriptionChars: 500,
  maxKeywords: 8,
  maxKeywordChars: 32,
  maxLicenseChars: 64,
  maxUrlChars: 500,
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

/** Publisher slug: `imgildev`, `acme`, `fulvid`, `test`. Not `local` (reserved). */
const PUBLISHER_PATTERN = /^[a-z][a-z0-9-]*$/;
const RESERVED_PUBLISHERS = new Set(["local"]);
/** Machine package name within a publisher: `todo-decorator`. */
const PACKAGE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
/** Canonical id = publisher.name */
const EXTENSION_ID_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
/** Semver-compatible package version. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const HTTP_URL_PATTERN = /^https:\/\/[^\s]+$/i;
const MAILTO_OR_URL_PATTERN = /^(https:\/\/[^\s]+|mailto:[^\s]+)$/i;

export type ExtensionManifest = {
  /** Canonical identity: `${publisher}.${name}`. */
  id: string;
  publisher: string;
  /** Machine-oriented package name (not the display title). */
  name: string;
  /** Human-readable product name shown in Settings / menus context. */
  displayName: string;
  version: string;
  api: number;
  description: string;
  author?: ExtensionAuthor;
  license?: string;
  homepage?: string;
  repository?: string;
  bugs?: string;
  keywords?: string[];
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
  publisher: string;
  name: string;
  displayName: string;
  version: string;
  api: number;
  description: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  bugs?: string;
  keywords?: string[];
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

/** Host install outcome (folder picker lives on the Bun side). */
export type ExtensionInstallResult =
  | { status: "cancelled" }
  | { status: "ok"; id: string; discovery: ExtensionDiscoveryResult }
  | { status: "error"; reason: string; discovery: ExtensionDiscoveryResult };

/** Host uninstall outcome. */
export type ExtensionUninstallResult =
  | { status: "ok"; discovery: ExtensionDiscoveryResult }
  | { status: "error"; reason: string; discovery: ExtensionDiscoveryResult };

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

/** Canonical identity: `publisher.name`. */
export function extensionIdFromPublisherName(publisher: string, name: string): string {
  return `${publisher}.${name}`;
}

export function isValidPublisher(publisher: string): boolean {
  return PUBLISHER_PATTERN.test(publisher) && !RESERVED_PUBLISHERS.has(publisher);
}

export function isValidPackageName(name: string): boolean {
  return PACKAGE_NAME_PATTERN.test(name);
}

export function isValidExtensionId(id: string): boolean {
  if (!EXTENSION_ID_PATTERN.test(id)) {
    return false;
  }
  const publisher = id.slice(0, id.indexOf("."));
  return isValidPublisher(publisher);
}

export function namespacedExtensionCommandId(extensionId: string, commandId: string): string {
  return `${extensionId}.${commandId}`;
}

/** Display string for Settings; objects use `.name`. */
export function formatExtensionAuthor(author: ExtensionAuthor): string {
  return typeof author === "string" ? author : author.name;
}

function parseHttpUrl(
  value: unknown,
  field: string,
): { ok: true; url: string } | { ok: false; reason: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, reason: `invalid ${field}` };
  }
  const url = value.trim();
  if (url.length > EXTENSION_PACK_LIMITS.maxUrlChars || !HTTP_URL_PATTERN.test(url)) {
    return { ok: false, reason: `invalid ${field}` };
  }
  return { ok: true, url };
}

function parseAuthor(
  value: unknown,
): { ok: true; author: ExtensionAuthor } | { ok: false; reason: string } {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 200) {
      return { ok: false, reason: "invalid author" };
    }
    return { ok: true, author: trimmed };
  }
  if (!isRecord(value) || typeof value.name !== "string" || value.name.trim().length === 0) {
    return { ok: false, reason: "invalid author" };
  }
  if (value.name.length > 200) {
    return { ok: false, reason: "author exceeds size limit" };
  }
  const author: { name: string; email?: string; url?: string } = { name: value.name.trim() };
  if (value.email !== undefined) {
    if (
      typeof value.email !== "string" ||
      value.email.trim().length === 0 ||
      value.email.length > 200
    ) {
      return { ok: false, reason: "invalid author email" };
    }
    author.email = value.email.trim();
  }
  if (value.url !== undefined) {
    const parsed = parseHttpUrl(value.url, "author url");
    if (!parsed.ok) {
      return parsed;
    }
    author.url = parsed.url;
  }
  return { ok: true, author };
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

  if (typeof value.publisher !== "string" || !PUBLISHER_PATTERN.test(value.publisher)) {
    return {
      reason: "invalid publisher: expect lowercase slug matching /^[a-z][a-z0-9-]*$/ (e.g. acme)",
    };
  }
  if (RESERVED_PUBLISHERS.has(value.publisher)) {
    return { reason: 'reserved publisher: "local" is not allowed; use your own slug' };
  }
  if (typeof value.name !== "string" || !isValidPackageName(value.name)) {
    return {
      reason:
        "invalid extension name: expect lowercase slug matching /^[a-z][a-z0-9-]*$/ (e.g. heading-nav)",
    };
  }
  const derivedId = extensionIdFromPublisherName(value.publisher, value.name);
  if (value.id !== undefined) {
    if (typeof value.id !== "string" || value.id !== derivedId) {
      return {
        reason: `id must equal publisher.name (expected "${derivedId}")`,
      };
    }
  }
  if (!isValidExtensionId(derivedId)) {
    return { reason: `invalid extension id: derived "${derivedId}" is not publisher.name` };
  }

  if (typeof value.displayName !== "string" || value.displayName.trim().length === 0) {
    return { reason: "invalid displayName: non-empty string required" };
  }
  if (value.displayName.length > EXTENSION_PACK_LIMITS.maxDisplayNameChars) {
    return { reason: "displayName exceeds size limit" };
  }

  if (typeof value.description !== "string" || value.description.trim().length === 0) {
    return { reason: "invalid description: non-empty string required" };
  }
  if (value.description.length > EXTENSION_PACK_LIMITS.maxDescriptionChars) {
    return { reason: "description exceeds size limit" };
  }

  if (typeof value.version !== "string" || !VERSION_PATTERN.test(value.version.trim())) {
    return {
      reason: 'invalid extension version: expect semver MAJOR.MINOR.PATCH (e.g. "1.0.0")',
    };
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
      return {
        reason: `invalid activation: expected "command" or "document" (got ${JSON.stringify(value.activation)})`,
      };
    }
    activation = value.activation;
  }

  let documentAction: string | undefined;
  if (value.documentAction !== undefined) {
    if (typeof value.documentAction !== "string" || !ACTION_ID_PATTERN.test(value.documentAction)) {
      return {
        reason:
          "invalid documentAction: expect command id matching /^[a-z][a-zA-Z0-9]*$/ (must match commands.register)",
      };
    }
    documentAction = value.documentAction;
  }
  if (activation === "document" && !documentAction) {
    return {
      reason:
        "document activation requires documentAction (Lua command id re-invoked on buffer changes)",
    };
  }
  if (documentAction && activation !== "document") {
    return {
      reason: 'documentAction requires activation: "document"',
    };
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
        return {
          reason: "invalid action id: expect /^[a-z][a-zA-Z0-9]*$/ matching a commands.register id",
        };
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
                ? `invalid menu target: ${rawAction.menu} (allowed: ${EXTENSION_MENU_TARGETS.join(", ")})`
                : `invalid menu target (allowed: ${EXTENSION_MENU_TARGETS.join(", ")})`,
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
          return { reason: "invalid action order: integer 0..10000 required" };
        }
        placement.order = rawAction.order;
      }
      if (rawAction.title !== undefined) {
        if (typeof rawAction.title !== "string" || rawAction.title.trim().length === 0) {
          return { reason: "invalid action title: non-empty string required" };
        }
        if (rawAction.title.length > 200) {
          return { reason: "action title exceeds size limit" };
        }
        placement.title = rawAction.title.trim();
      }
      actions.push(placement);
    }
  }

  let author: ExtensionAuthor | undefined;
  if (value.author !== undefined) {
    const parsed = parseAuthor(value.author);
    if (!parsed.ok) {
      return parsed;
    }
    author = parsed.author;
  }

  let license: string | undefined;
  if (value.license !== undefined) {
    if (
      typeof value.license !== "string" ||
      value.license.trim().length === 0 ||
      value.license.length > EXTENSION_PACK_LIMITS.maxLicenseChars
    ) {
      return { reason: "invalid license" };
    }
    license = value.license.trim();
  }

  let homepage: string | undefined;
  if (value.homepage !== undefined) {
    const parsed = parseHttpUrl(value.homepage, "homepage");
    if (!parsed.ok) {
      return parsed;
    }
    homepage = parsed.url;
  }

  let repository: string | undefined;
  if (value.repository !== undefined) {
    if (typeof value.repository === "string") {
      const parsed = parseHttpUrl(value.repository, "repository");
      if (!parsed.ok) {
        return parsed;
      }
      repository = parsed.url;
    } else if (isRecord(value.repository)) {
      const parsed = parseHttpUrl(value.repository.url, "repository");
      if (!parsed.ok) {
        return parsed;
      }
      repository = parsed.url;
    } else {
      return { reason: "invalid repository" };
    }
  }

  let bugs: string | undefined;
  if (value.bugs !== undefined) {
    if (typeof value.bugs === "string") {
      const trimmed = value.bugs.trim();
      if (
        trimmed.length === 0 ||
        trimmed.length > EXTENSION_PACK_LIMITS.maxUrlChars ||
        !MAILTO_OR_URL_PATTERN.test(trimmed)
      ) {
        return { reason: "invalid bugs" };
      }
      bugs = trimmed;
    } else if (isRecord(value.bugs)) {
      const parsed = parseHttpUrl(value.bugs.url, "bugs");
      if (!parsed.ok) {
        return { reason: "invalid bugs" };
      }
      bugs = parsed.url;
    } else {
      return { reason: "invalid bugs" };
    }
  }

  let keywords: string[] | undefined;
  if (value.keywords !== undefined) {
    if (!Array.isArray(value.keywords)) {
      return { reason: "invalid keywords" };
    }
    if (value.keywords.length > EXTENSION_PACK_LIMITS.maxKeywords) {
      return { reason: "too many keywords" };
    }
    keywords = [];
    const seen = new Set<string>();
    for (const entry of value.keywords) {
      if (
        typeof entry !== "string" ||
        entry.trim().length === 0 ||
        entry.length > EXTENSION_PACK_LIMITS.maxKeywordChars
      ) {
        return { reason: "invalid keyword" };
      }
      const keyword = entry.trim().toLowerCase();
      if (seen.has(keyword)) {
        continue;
      }
      seen.add(keyword);
      keywords.push(keyword);
    }
  }

  const manifest: ExtensionManifest = {
    id: derivedId,
    publisher: value.publisher,
    name: value.name,
    displayName: value.displayName.trim(),
    version: value.version.trim(),
    api: value.api,
    description: value.description.trim(),
    capabilities,
    activation,
  };
  if (author !== undefined) {
    manifest.author = author;
  }
  if (license !== undefined) {
    manifest.license = license;
  }
  if (homepage !== undefined) {
    manifest.homepage = homepage;
  }
  if (repository !== undefined) {
    manifest.repository = repository;
  }
  if (bugs !== undefined) {
    manifest.bugs = bugs;
  }
  if (keywords !== undefined) {
    manifest.keywords = keywords;
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
