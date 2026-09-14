import { appendFile, writeFile } from "node:fs/promises";

export type SecurityScope = "production" | "development";
export type SecurityDependencyType = "direct" | "transitive";
export type SecurityStatus = "no-updates" | "plan" | "fixed" | "blocked";

export type SecurityAdvisory = {
  packageName: string;
  advisory: string;
  severity: string;
  title: string;
  url?: string;
  current?: string;
  fixed?: string;
  scope: SecurityScope;
  dependencyType: SecurityDependencyType;
  via?: string;
};

export type SecurityFix = {
  packageName: string;
  from?: string;
  to?: string;
};

export type SecurityDecision = {
  status: SecurityStatus;
  vulnerabilitiesBefore: number;
  vulnerabilitiesAfter: number;
  changedFiles: readonly string[];
};

export type SecurityPullRequestAction = "create" | "update" | "skip";

type JsonRecord = Record<string, unknown>;

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type AuditSnapshot = {
  all: readonly SecurityAdvisory[];
  production: readonly SecurityAdvisory[];
};

const MINIMUM_BUN_VERSION = "1.4.2";
const SECURITY_MARKER = "<!-- fulvid-security-dependency-maintenance -->";
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asIdentifier(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstString(record: JsonRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "");
}

function parseJson(value: string): unknown {
  const clean = stripAnsi(value).trim();
  if (!clean) {
    return {};
  }
  try {
    return JSON.parse(clean) as unknown;
  } catch {
    return {};
  }
}

function advisoryKey(advisory: SecurityAdvisory): string {
  return `${advisory.packageName}:${advisory.advisory}:${advisory.scope}`;
}

function normalizeSeverity(value: unknown): string {
  return asString(value)?.toLowerCase() ?? "unknown";
}

function advisoryFromVulnerability(
  packageName: string,
  value: JsonRecord,
  via: JsonRecord | undefined,
  directPackages: ReadonlySet<string>,
  productionPackages: ReadonlySet<string>,
): SecurityAdvisory {
  const fix = asRecord(value.fixAvailable);
  const findings = asArray(value.findings);
  const finding = asRecord(findings[0]);
  const paths = asArray(finding?.paths).filter((path): path is string => typeof path === "string");

  return {
    packageName,
    advisory: firstString(via ?? {}, ["source", "id", "ghsa"]) ?? "unknown",
    severity: normalizeSeverity(via?.severity ?? value.severity),
    title: firstString(via ?? {}, ["title", "name"]) ?? `${packageName} has a known vulnerability`,
    url: firstString(via ?? {}, ["url", "web"]),
    current: firstString(value, ["version"]) ?? firstString(finding ?? {}, ["version"]),
    fixed: firstString(fix ?? {}, ["version"]) ?? firstString(via ?? {}, ["patched_versions"]),
    scope: productionPackages.has(packageName) ? "production" : "development",
    dependencyType:
      value.isDirect === true ||
      directPackages.has(packageName) ||
      paths.some((path) => path === packageName)
        ? "direct"
        : "transitive",
    via: paths.length > 1 ? paths.slice(0, -1).join(" → ") : undefined,
  };
}

function legacyAdvisories(
  advisories: JsonRecord,
  directPackages: ReadonlySet<string>,
  productionPackages: ReadonlySet<string>,
): SecurityAdvisory[] {
  const result: SecurityAdvisory[] = [];
  for (const [id, raw] of Object.entries(advisories)) {
    const value = asRecord(raw);
    if (!value) {
      continue;
    }
    const findings = asArray(value.findings);
    const finding = asRecord(findings[0]);
    const paths = asArray(finding?.paths).filter(
      (path): path is string => typeof path === "string",
    );
    const packageName = firstString(value, ["module_name", "name"]);
    if (!packageName) {
      continue;
    }
    result.push({
      packageName,
      advisory: id,
      severity: normalizeSeverity(value.severity),
      title:
        firstString(value, ["title", "overview"]) ?? `${packageName} has a known vulnerability`,
      url: firstString(value, ["url"]),
      current: firstString(finding ?? {}, ["version"]),
      fixed: firstString(value, ["patched_versions"]),
      scope: productionPackages.has(packageName) ? "production" : "development",
      dependencyType:
        directPackages.has(packageName) || paths.some((path) => path === packageName)
          ? "direct"
          : "transitive",
      via: paths.length > 1 ? paths.slice(0, -1).join(" → ") : undefined,
    });
  }
  return result;
}

function registryAdvisories(
  root: JsonRecord,
  directPackages: ReadonlySet<string>,
  productionPackages: ReadonlySet<string>,
): SecurityAdvisory[] {
  const result: SecurityAdvisory[] = [];
  const reservedKeys = new Set(["advisories", "auditReportVersion", "metadata", "vulnerabilities"]);
  for (const [packageName, rawEntries] of Object.entries(root)) {
    if (reservedKeys.has(packageName) || !Array.isArray(rawEntries)) {
      continue;
    }
    for (const rawEntry of rawEntries) {
      const entry = asRecord(rawEntry);
      if (!entry) {
        continue;
      }
      result.push({
        packageName,
        advisory: asIdentifier(entry.id) ?? firstString(entry, ["source", "ghsa"]) ?? "unknown",
        severity: normalizeSeverity(entry.severity),
        title: firstString(entry, ["title", "name"]) ?? `${packageName} has a known vulnerability`,
        url: firstString(entry, ["url", "web"]),
        current: firstString(entry, ["version"]),
        fixed: firstString(entry, ["patched_versions", "fixed", "fixed_version"]),
        scope: productionPackages.has(packageName) ? "production" : "development",
        dependencyType: directPackages.has(packageName) ? "direct" : "transitive",
      });
    }
  }
  return result;
}

/**
 * Parse Bun's npm-audit-compatible JSON without maintaining advisory data.
 *
 * Bun has emitted both `vulnerabilities` and legacy `advisories` shapes across
 * supported releases, so the parser accepts both while leaving the registry
 * response as the source of truth.
 */
export function parseAuditReport(
  raw: string,
  options: {
    directPackages?: ReadonlySet<string>;
    productionPackages?: ReadonlySet<string>;
  } = {},
): SecurityAdvisory[] {
  const root = asRecord(parseJson(raw));
  if (!root) {
    return [];
  }
  const directPackages = options.directPackages ?? new Set<string>();
  const productionPackages = options.productionPackages ?? new Set<string>();
  const result: SecurityAdvisory[] = [];

  const vulnerabilities = asRecord(root.vulnerabilities);
  if (vulnerabilities) {
    for (const [packageName, rawVulnerability] of Object.entries(vulnerabilities)) {
      const vulnerability = asRecord(rawVulnerability);
      if (!vulnerability) {
        continue;
      }
      const via = asArray(vulnerability.via)
        .map(asRecord)
        .filter((item): item is JsonRecord => item !== null);
      if (via.length === 0) {
        result.push(
          advisoryFromVulnerability(
            packageName,
            vulnerability,
            undefined,
            directPackages,
            productionPackages,
          ),
        );
      } else {
        result.push(
          ...via.map((item) =>
            advisoryFromVulnerability(
              packageName,
              vulnerability,
              item,
              directPackages,
              productionPackages,
            ),
          ),
        );
      }
    }
  }

  const legacy = asRecord(root.advisories);
  if (legacy) {
    result.push(...legacyAdvisories(legacy, directPackages, productionPackages));
  }
  result.push(...registryAdvisories(root, directPackages, productionPackages));

  return [...new Map(result.map((item) => [advisoryKey(item), item])).values()];
}

function parseFixEntry(value: unknown): SecurityFix | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const packageName = firstString(record, [
    "package",
    "packageName",
    "name",
    "module",
    "dependency",
  ]);
  if (!packageName) {
    return null;
  }
  return {
    packageName,
    from: firstString(record, ["from", "current", "installed", "version"]),
    to: firstString(record, ["to", "target", "fixed", "resolved"]),
  };
}

export function parseFixPlan(raw: string): SecurityFix[] {
  const root = asRecord(parseJson(raw));
  if (!root) {
    return [];
  }
  const fixes = asArray(root.fixes)
    .map(parseFixEntry)
    .filter((item): item is SecurityFix => item !== null);
  return [...new Map(fixes.map((item) => [item.packageName, item])).values()];
}

export function parseFixPlanIssues(raw: string): string[] {
  const root = asRecord(parseJson(raw));
  if (!root) {
    return [];
  }
  const issues: string[] = [];
  for (const key of ["blocked", "unfixable", "unmatched"]) {
    for (const rawIssue of asArray(root[key])) {
      const issue = asRecord(rawIssue);
      if (!issue) {
        continue;
      }
      const name = firstString(issue, ["name", "package", "packageName", "dependency"]);
      if (!name) {
        continue;
      }
      const from = firstString(issue, ["from", "current", "installed"]);
      const to = firstString(issue, ["to", "target", "fixed"]);
      const blockers = asArray(issue.blockers)
        .map(asRecord)
        .filter((item): item is JsonRecord => item !== null)
        .map((item) => firstString(item, ["dependent", "name"]))
        .filter((item): item is string => item !== undefined);
      const reason =
        blockers.length > 0
          ? `blocked by ${blockers.join(", ")}`
          : key === "unfixable"
            ? "no published safe version was reported"
            : key;
      issues.push(`${key}: ${name}${from ? ` ${from}` : ""}${to ? ` → ${to}` : ""} (${reason})`);
    }
  }
  return issues;
}

function semverParts(value: string | undefined): [number, number, number] | null {
  const match = value?.match(/(\d+)\.(\d+)\.(\d+)/);
  return match
    ? [
        Number.parseInt(match[1] ?? "0", 10),
        Number.parseInt(match[2] ?? "0", 10),
        Number.parseInt(match[3] ?? "0", 10),
      ]
    : null;
}

export function releaseType(
  from: string | undefined,
  to: string | undefined,
): "patch" | "minor" | "major" | "unknown" {
  const previous = semverParts(from);
  const next = semverParts(to);
  if (!previous || !next) {
    return "unknown";
  }
  if (previous[0] !== next[0]) {
    return "major";
  }
  if (previous[1] !== next[1]) {
    return "minor";
  }
  return "patch";
}

export function decideSecurityUpdate(
  vulnerabilitiesBefore: number,
  vulnerabilitiesAfter: number,
  changedFiles: readonly string[],
): SecurityDecision {
  if (vulnerabilitiesBefore === 0 || (vulnerabilitiesAfter === 0 && changedFiles.length === 0)) {
    return {
      status: "no-updates",
      vulnerabilitiesBefore,
      vulnerabilitiesAfter,
      changedFiles,
    };
  }
  if (vulnerabilitiesAfter > 0) {
    return {
      status: "blocked",
      vulnerabilitiesBefore,
      vulnerabilitiesAfter,
      changedFiles,
    };
  }
  return {
    status: "fixed",
    vulnerabilitiesBefore,
    vulnerabilitiesAfter,
    changedFiles,
  };
}

export function shouldCreateSecurityPullRequest(decision: SecurityDecision): boolean {
  return decision.status === "fixed" && decision.changedFiles.length > 0;
}

export function securityPullRequestAction(
  decision: SecurityDecision,
  hasOpenPullRequest: boolean,
): SecurityPullRequestAction {
  if (!shouldCreateSecurityPullRequest(decision)) {
    return "skip";
  }
  return hasOpenPullRequest ? "update" : "create";
}

function command(args: readonly string[]): CommandResult {
  const result = Bun.spawnSync([...args], { stdout: "pipe", stderr: "pipe" });
  const decode = (value: unknown): string =>
    typeof value === "string" ? value : new TextDecoder().decode(value as unknown as Uint8Array);
  return {
    exitCode: result.exitCode,
    stdout: decode(result.stdout),
    stderr: decode(result.stderr),
  };
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference > 0 ? 1 : -1;
    }
  }
  return 0;
}

async function readPackageMetadata(): Promise<{ dependencies: Set<string>; direct: Set<string> }> {
  const packageJson = (await Bun.file("package.json").json()) as {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };
  const dependencies = new Set(Object.keys(packageJson.dependencies ?? {}));
  const direct = new Set([...dependencies, ...Object.keys(packageJson.devDependencies ?? {})]);
  return { dependencies, direct };
}

async function readLockedVersions(): Promise<Map<string, string>> {
  const lock = Bun.JSON5.parse(await Bun.file("bun.lock").text()) as {
    packages?: Record<string, unknown>;
  };
  const versions = new Map<string, Set<string>>();
  for (const rawPackage of Object.values(lock.packages ?? {})) {
    if (!Array.isArray(rawPackage)) {
      continue;
    }
    const locator = asString(rawPackage[0]);
    if (!locator) {
      continue;
    }
    const separator = locator.lastIndexOf("@");
    if (separator <= 0) {
      continue;
    }
    const name = locator.slice(0, separator);
    const version = locator.slice(separator + 1);
    const entries = versions.get(name) ?? new Set<string>();
    entries.add(version);
    versions.set(name, entries);
  }
  return new Map(
    [...versions.entries()].map(([name, entries]) => [name, [...entries].sort().join(", ")]),
  );
}

function addLockedVersions(
  advisories: readonly SecurityAdvisory[],
  versions: ReadonlyMap<string, string>,
): SecurityAdvisory[] {
  return advisories.map((advisory) => ({
    ...advisory,
    current: advisory.current ?? versions.get(advisory.packageName),
  }));
}

function audit(
  production: boolean,
  direct: ReadonlySet<string>,
  productionPackages?: ReadonlySet<string>,
): {
  command: CommandResult;
  advisories: SecurityAdvisory[];
} {
  const result = command(["bun", "audit", ...(production ? ["--prod"] : []), "--json"]);
  const advisories = parseAuditReport(result.stdout, {
    directPackages: direct,
    productionPackages: productionPackages ?? new Set<string>(),
  });
  if (result.exitCode > 1 || (result.exitCode === 1 && advisories.length === 0)) {
    throw new Error(
      `bun audit ${production ? "--prod " : ""}failed: ${result.stderr || result.stdout}`,
    );
  }
  return { command: result, advisories };
}

function snapshot(
  direct: ReadonlySet<string>,
  productionPackages = new Set<string>(),
): AuditSnapshot {
  const all = audit(false, direct, productionPackages).advisories;
  const production = audit(true, direct, new Set<string>()).advisories;
  return { all, production };
}

function changedFiles(): string[] {
  const result = command(["git", "diff", "--name-only"]);
  if (result.exitCode !== 0) {
    throw new Error(`git diff failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function mergeProductionScope(
  all: readonly SecurityAdvisory[],
  production: readonly SecurityAdvisory[],
): SecurityAdvisory[] {
  const productionKeys = new Set(production.map((item) => `${item.packageName}:${item.advisory}`));
  return all.map((item) =>
    productionKeys.has(`${item.packageName}:${item.advisory}`)
      ? { ...item, scope: "production" }
      : item,
  );
}

function advisoryForPackage(
  advisories: readonly SecurityAdvisory[],
  packageName: string,
): SecurityAdvisory | undefined {
  return advisories.find((item) => item.packageName === packageName);
}

function renderSecurityReport(
  before: readonly SecurityAdvisory[],
  after: readonly SecurityAdvisory[],
  fixes: readonly SecurityFix[],
  status: SecurityStatus,
  planIssues: readonly string[] = [],
): string {
  const resolved = fixes.map((fix) => {
    const advisory = advisoryForPackage(before, fix.packageName);
    return {
      packageName: fix.packageName,
      from: fix.from ?? advisory?.current ?? "unknown",
      to: fix.to ?? advisory?.fixed ?? "unknown",
      type: releaseType(fix.from ?? advisory?.current, fix.to ?? advisory?.fixed),
      severity: advisory?.severity ?? "unknown",
      scope: advisory?.scope ?? "development",
      dependencyType: advisory?.dependencyType ?? "transitive",
      via:
        advisory?.via ??
        (advisory?.dependencyType === "transitive" ? "transitive dependency" : "-"),
      advisory,
    };
  });

  const lines = [
    SECURITY_MARKER,
    "Security dependency review completed.",
    "",
    "## Security updates",
    "",
    `Vulnerabilities found: ${before.length}`,
    `Vulnerabilities remaining: ${after.length}`,
    `Security updates required: ${status === "fixed" ? resolved.length : 0}`,
    `Pull requests created: ${status === "fixed" ? "pending" : "0"}`,
    "",
  ];

  if (resolved.length > 0) {
    lines.push(
      "| Dependency | Via | From | To | Update | Kind | Severity | Scope |",
      "| --- | --- | ---: | ---: | --- | --- | --- | --- |",
      ...resolved.map(
        (item) =>
          `| ${item.packageName} | ${item.via} | ${item.from} | ${item.to} | ${item.type} | ${item.dependencyType} | ${item.severity} | ${item.scope} |`,
      ),
      "",
      "### Reason",
      "",
      ...resolved.map((item) => {
        const reference = item.advisory?.url ? ` ([advisory](${item.advisory.url}))` : "";
        return `- **${item.packageName}**: ${item.advisory?.title ?? "known vulnerability"}${reference}`;
      }),
      "",
    );
  }

  const scopes = [
    ...new Set(
      status === "blocked" ? before.map((item) => item.scope) : resolved.map((item) => item.scope),
    ),
  ];
  const hasMajorUpdate = resolved.some((item) => item.type === "major");
  if (before.length > 0) {
    lines.push(
      "### Scope",
      "",
      ...scopes.map((scope) => `- ${scope}`),
      "",
      "### Notes",
      "",
      hasMajorUpdate
        ? "- A major update was selected only after the minimal security fix left an advisory unresolved."
        : "- Versions are limited to the security fixes selected by Bun; unrelated outdated dependencies are not updated.",
      "",
    );
  }

  if (status === "blocked") {
    lines.push(
      "### Manual attention required",
      "",
      ...planIssues.map((issue) => `- ${issue}`),
      ...after.map(
        (item) =>
          `- **${item.packageName}** (${item.severity}, ${item.scope}, ${item.dependencyType}): ${item.title}${item.url ? ` ([advisory](${item.url}))` : ""}`,
      ),
      "",
      "No pull request was created because the security update did not leave the tree vulnerability-free.",
      "",
    );
  } else if (status === "no-updates") {
    lines.push("No security update pull request was created.", "");
  }

  return `${lines.join("\n")}\n`;
}

function writeGitHubOutput(values: Record<string, string>): Promise<void> {
  const output = process.env.GITHUB_OUTPUT;
  return output
    ? appendFile(
        output,
        `${Object.entries(values)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n")}\n`,
      )
    : Promise.resolve();
}

function optionsFromArgs(args: readonly string[]): { apply: boolean; report?: string } {
  const reportIndex = args.indexOf("--report");
  return {
    apply: args.includes("--apply"),
    report: reportIndex >= 0 ? args[reportIndex + 1] : undefined,
  };
}

export async function runSecurityMaintenance(
  args: readonly string[] = process.argv.slice(2),
): Promise<{
  status: SecurityStatus;
  report: string;
}> {
  const options = optionsFromArgs(args);
  const metadata = await readPackageMetadata();
  const lockedVersions = await readLockedVersions();
  const beforeSnapshot = snapshot(metadata.direct);
  const before = addLockedVersions(
    mergeProductionScope(beforeSnapshot.all, beforeSnapshot.production),
    lockedVersions,
  );

  if (before.length === 0) {
    const report = renderSecurityReport([], [], [], "no-updates");
    await writeGitHubOutput({ status: "no-updates", vulnerabilities: "0", changes: "false" });
    return { status: "no-updates", report };
  }

  if (!options.apply) {
    const report = renderSecurityReport(before, before, [], "plan");
    await writeGitHubOutput({
      status: "plan",
      vulnerabilities: String(before.length),
      changes: "false",
    });
    return { status: "plan", report };
  }

  if (compareVersions(Bun.version, MINIMUM_BUN_VERSION) < 0) {
    throw new Error(`Security updates require Bun >= ${MINIMUM_BUN_VERSION}; found ${Bun.version}`);
  }

  const minimalFix = command(["bun", "audit", "fix", "--ignore-scripts", "--json"]);
  if (minimalFix.exitCode > 1 && parseFixPlan(minimalFix.stdout).length === 0) {
    throw new Error(`bun audit fix failed: ${minimalFix.stderr || minimalFix.stdout}`);
  }

  let afterSnapshot = snapshot(metadata.direct);
  let fixes = parseFixPlan(minimalFix.stdout);
  let planIssues = parseFixPlanIssues(minimalFix.stdout);
  if (afterSnapshot.all.length > 0) {
    const latestFix = command(["bun", "audit", "fix", "--latest", "--ignore-scripts", "--json"]);
    if (latestFix.exitCode > 1 && parseFixPlan(latestFix.stdout).length === 0) {
      throw new Error(`bun audit fix --latest failed: ${latestFix.stderr || latestFix.stdout}`);
    }
    fixes = [...fixes, ...parseFixPlan(latestFix.stdout)];
    planIssues = [...planIssues, ...parseFixPlanIssues(latestFix.stdout)];
    afterSnapshot = snapshot(metadata.direct);
  }

  const after = addLockedVersions(
    mergeProductionScope(afterSnapshot.all, afterSnapshot.production),
    await readLockedVersions(),
  );
  const decision = decideSecurityUpdate(before.length, after.length, changedFiles());
  const uniqueFixes = [...new Map(fixes.map((item) => [item.packageName, item])).values()];
  const reportFixes =
    uniqueFixes.length > 0
      ? uniqueFixes
      : before.map((advisory) => ({
          packageName: advisory.packageName,
          from: advisory.current,
          to: advisory.fixed,
        }));
  const report = renderSecurityReport(before, after, reportFixes, decision.status, planIssues);
  await writeGitHubOutput({
    status: decision.status,
    vulnerabilities: String(before.length),
    changes: shouldCreateSecurityPullRequest(decision) ? "true" : "false",
  });
  return { status: decision.status, report };
}

async function main(): Promise<number> {
  const result = await runSecurityMaintenance();
  const reportPath = optionsFromArgs(process.argv.slice(2)).report;
  if (reportPath) {
    await writeFile(reportPath, result.report);
  }
  console.log(result.report);
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
