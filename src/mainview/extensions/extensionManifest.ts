/**
 * Declarative extension manifest contract (api: 0).
 *
 * Extensions are data. This module validates declarations only — it does not
 * load code, Lua, or grant filesystem/Monaco authority.
 */

export const EXTENSION_API_VERSION = 0;

/** Closed capability surface for api: 0. Declaring a capability grants no resource. */
export const ALLOWED_EXTENSION_CAPABILITIES = ["commands", "templates", "ui"] as const;

export type ExtensionCapability = (typeof ALLOWED_EXTENSION_CAPABILITIES)[number];

export const ALLOWED_EXTENSION_ACTIONS = ["notify", "createUntitledFromTemplate"] as const;

export type ExtensionHostAction = (typeof ALLOWED_EXTENSION_ACTIONS)[number];

const FORBIDDEN_MANIFEST_KEYS = new Set([
  "main",
  "entry",
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
  commands?: ExtensionManifestCommand[];
  templates?: ExtensionManifestTemplate[];
};

/** Host→renderer DTO after discovery (template bodies already loaded). */
export type DiscoveredExtensionCommand = {
  id: string;
  namespacedId: string;
  title: string;
  action: ExtensionHostAction;
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
 * Validate a parsed JSON value as an api:0 declarative manifest.
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
  const templates: ExtensionManifestTemplate[] = [];
  if (value.templates !== undefined) {
    if (!capabilitySet.has("templates")) {
      return { reason: "templates require the templates capability" };
    }
    if (!Array.isArray(value.templates)) {
      return { reason: "templates must be an array" };
    }
    const templateIds = new Set<string>();
    for (const entry of value.templates) {
      if (!isRecord(entry)) {
        return { reason: "template entry must be an object" };
      }
      if (typeof entry.id !== "string" || !TEMPLATE_ID_PATTERN.test(entry.id)) {
        return { reason: "invalid template id" };
      }
      if (templateIds.has(entry.id)) {
        return { reason: `duplicate template id: ${entry.id}` };
      }
      templateIds.add(entry.id);
      if (typeof entry.name !== "string" || entry.name.trim().length === 0) {
        return { reason: "invalid template name" };
      }
      if (typeof entry.file !== "string" || entry.file.trim().length === 0) {
        return { reason: "invalid template file" };
      }
      templates.push({ id: entry.id, name: entry.name, file: entry.file });
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
    for (const entry of value.commands) {
      if (!isRecord(entry)) {
        return { reason: "command entry must be an object" };
      }
      for (const key of ["code", "script", "eval", "lua", "html", "svg", "component"] as const) {
        if (key in entry) {
          return { reason: `forbidden command field: ${key}` };
        }
      }
      if (typeof entry.id !== "string" || !COMMAND_ID_PATTERN.test(entry.id)) {
        return { reason: "invalid command id" };
      }
      if (commandIds.has(entry.id)) {
        return { reason: `duplicate command id: ${entry.id}` };
      }
      commandIds.add(entry.id);
      if (typeof entry.title !== "string" || entry.title.trim().length === 0) {
        return { reason: "invalid command title" };
      }
      if (typeof entry.action !== "string" || !isAllowedAction(entry.action)) {
        return { reason: `unknown host action: ${String(entry.action)}` };
      }

      const command: ExtensionManifestCommand = {
        id: entry.id,
        title: entry.title,
        action: entry.action,
      };

      if (entry.action === "notify") {
        if (typeof entry.message !== "string" || entry.message.trim().length === 0) {
          return { reason: "notify action requires message" };
        }
        command.message = entry.message;
      }

      if (entry.action === "createUntitledFromTemplate") {
        if (!capabilitySet.has("templates")) {
          return { reason: "createUntitledFromTemplate requires the templates capability" };
        }
        if (typeof entry.template !== "string" || !TEMPLATE_ID_PATTERN.test(entry.template)) {
          return { reason: "createUntitledFromTemplate requires a template id" };
        }
        if (!templates.some((template) => template.id === entry.template)) {
          return { reason: `unknown template: ${entry.template}` };
        }
        command.template = entry.template;
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
  if (commands.length > 0) {
    manifest.commands = commands;
  }
  if (templates.length > 0) {
    manifest.templates = templates;
  }

  return { manifest };
}
