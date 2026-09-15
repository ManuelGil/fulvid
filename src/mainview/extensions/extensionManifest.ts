/**
 * Extension manifest contract (api: 0).
 *
 * Declarative packs are data-only. Packs with the `lua` capability may declare
 * a relative `entry` source path loaded only by the Bun-host Lua/Wasm runtime.
 * Validation here never executes Lua and grants no filesystem/Monaco authority.
 */

export const EXTENSION_API_VERSION = 0;

/**
 * Closed capability surface for api: 0.
 * Declaring a capability grants no resource. `lua` selects the host Wasm runtime.
 */
export const ALLOWED_EXTENSION_CAPABILITIES = [
  "commands",
  "templates",
  "ui",
  "lua",
  "editor",
] as const;

export type ExtensionCapability = (typeof ALLOWED_EXTENSION_CAPABILITIES)[number];

export const ALLOWED_EXTENSION_ACTIONS = ["notify", "createUntitledFromTemplate"] as const;

export type ExtensionHostAction = (typeof ALLOWED_EXTENSION_ACTIONS)[number];

/** Includes host-only `lua` for commands registered from entry.lua (not in manifests). */
export type ExtensionCommandAction = ExtensionHostAction | "lua";

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
]);

/** `local.<name>` ids — fixtures and user packs share this shape. */
const EXTENSION_ID_PATTERN = /^local\.[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/;
const COMMAND_ID_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
const TEMPLATE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export type ExtensionManifestCommand = {
  id: string;
  title: string;
  action: ExtensionHostAction;
  message?: string;
  template?: string;
};

export type ExtensionManifestTemplate = {
  id: string;
  name: string;
  file: string;
};

export type ExtensionManifest = {
  id: string;
  name: string;
  version: string;
  api: number;
  description?: string;
  capabilities: ExtensionCapability[];
  /** Relative `.lua` source — required when capabilities include `lua`. */
  entry?: string;
  commands?: ExtensionManifestCommand[];
  templates?: ExtensionManifestTemplate[];
};

/** Host→renderer DTO after discovery (template bodies already loaded). */
export type DiscoveredExtensionCommand = {
  id: string;
  namespacedId: string;
  title: string;
  action: ExtensionCommandAction;
  message?: string;
  template?: string;
};

export type DiscoveredExtensionTemplate = {
  id: string;
  name: string;
  content: string;
};

export type DiscoveredExtension = {
  id: string;
  name: string;
  version: string;
  api: number;
  description?: string;
  capabilities: string[];
  commands: DiscoveredExtensionCommand[];
  templates: DiscoveredExtensionTemplate[];
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

function isAllowedAction(value: string): value is ExtensionHostAction {
  return (ALLOWED_EXTENSION_ACTIONS as readonly string[]).includes(value);
}

export function isValidExtensionId(id: string): boolean {
  return EXTENSION_ID_PATTERN.test(id);
}

export function namespacedExtensionCommandId(extensionId: string, commandId: string): string {
  return `${extensionId}.${commandId}`;
}

export function parseNamespacedExtensionCommandId(
  namespacedId: string,
): { extensionId: string; commandId: string } | null {
  const separator = namespacedId.lastIndexOf(".");
  if (separator <= 0 || separator === namespacedId.length - 1) {
    return null;
  }
  // extension ids contain dots (`local.capability-notify`); command id is the final segment.
  const commandId = namespacedId.slice(separator + 1);
  const extensionId = namespacedId.slice(0, separator);
  if (!isValidExtensionId(extensionId) || !COMMAND_ID_PATTERN.test(commandId)) {
    return null;
  }
  return { extensionId, commandId };
}

/**
 * Validate a parsed JSON value as an api:0 manifest.
 * Returns a reason string on failure — never throws.
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

  if (hasLua && value.commands !== undefined) {
    return { reason: "lua packs register commands from entry.lua, not the manifest" };
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

  const templates: ExtensionManifestTemplate[] = [];
  if (value.templates !== undefined) {
    if (!capabilitySet.has("templates")) {
      return { reason: "templates require the templates capability" };
    }
    if (!Array.isArray(value.templates)) {
      return { reason: "templates must be an array" };
    }
    const templateIds = new Set<string>();
    for (const entryTemplate of value.templates) {
      if (!isRecord(entryTemplate)) {
        return { reason: "template entry must be an object" };
      }
      if (typeof entryTemplate.id !== "string" || !TEMPLATE_ID_PATTERN.test(entryTemplate.id)) {
        return { reason: "invalid template id" };
      }
      if (templateIds.has(entryTemplate.id)) {
        return { reason: `duplicate template id: ${entryTemplate.id}` };
      }
      templateIds.add(entryTemplate.id);
      if (typeof entryTemplate.name !== "string" || entryTemplate.name.trim().length === 0) {
        return { reason: "invalid template name" };
      }
      if (typeof entryTemplate.file !== "string" || entryTemplate.file.trim().length === 0) {
        return { reason: "invalid template file" };
      }
      templates.push({
        id: entryTemplate.id,
        name: entryTemplate.name,
        file: entryTemplate.file,
      });
    }
  }

  const commands: ExtensionManifestCommand[] = [];
  if (value.commands !== undefined) {
    if (!capabilitySet.has("commands")) {
      return { reason: "commands require the commands capability" };
    }
    if (!Array.isArray(value.commands)) {
      return { reason: "commands must be an array" };
    }
    const commandIds = new Set<string>();
    for (const entryCommand of value.commands) {
      if (!isRecord(entryCommand)) {
        return { reason: "command entry must be an object" };
      }
      for (const key of ["code", "script", "eval", "lua", "html", "svg", "component"] as const) {
        if (key in entryCommand) {
          return { reason: `forbidden command field: ${key}` };
        }
      }
      if (typeof entryCommand.id !== "string" || !COMMAND_ID_PATTERN.test(entryCommand.id)) {
        return { reason: "invalid command id" };
      }
      if (commandIds.has(entryCommand.id)) {
        return { reason: `duplicate command id: ${entryCommand.id}` };
      }
      commandIds.add(entryCommand.id);
      if (typeof entryCommand.title !== "string" || entryCommand.title.trim().length === 0) {
        return { reason: "invalid command title" };
      }
      if (typeof entryCommand.action !== "string" || !isAllowedAction(entryCommand.action)) {
        return { reason: `unknown host action: ${String(entryCommand.action)}` };
      }

      const command: ExtensionManifestCommand = {
        id: entryCommand.id,
        title: entryCommand.title,
        action: entryCommand.action,
      };

      if (entryCommand.action === "notify") {
        if (typeof entryCommand.message !== "string" || entryCommand.message.trim().length === 0) {
          return { reason: "notify action requires message" };
        }
        command.message = entryCommand.message;
      }

      if (entryCommand.action === "createUntitledFromTemplate") {
        if (!capabilitySet.has("templates")) {
          return { reason: "createUntitledFromTemplate requires the templates capability" };
        }
        if (
          typeof entryCommand.template !== "string" ||
          !TEMPLATE_ID_PATTERN.test(entryCommand.template)
        ) {
          return { reason: "createUntitledFromTemplate requires a template id" };
        }
        if (!templates.some((template) => template.id === entryCommand.template)) {
          return { reason: `unknown template: ${entryCommand.template}` };
        }
        command.template = entryCommand.template;
      }

      commands.push(command);
    }
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
  if (commands.length > 0) {
    manifest.commands = commands;
  }
  if (templates.length > 0) {
    manifest.templates = templates;
  }

  return { manifest };
}
