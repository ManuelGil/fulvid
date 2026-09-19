/**
 * Local validation gate - static checks first, then tests, then build.
 *
 * Run with: bun run validate
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

type Step = {
  name: string;
  command: string;
  args: string[];
};

const steps: Step[] = [
  { name: "Format", command: "bun", args: ["run", "format:check"] },
  { name: "i18n", command: "bun", args: ["run", "i18n:check"] },
  { name: "Lint", command: "bun", args: ["run", "lint"] },
  { name: "Typecheck", command: "bun", args: ["run", "typecheck"] },
  { name: "Tests", command: "bun", args: ["run", "test"] },
  { name: "Build", command: "bun", args: ["run", "build"] },
  { name: "Whitespace", command: "git", args: ["diff", "--check"] },
  { name: "Doctor", command: "bun", args: ["run", "doctor"] },
];

console.log("\nFulvid validate\n");

for (const step of steps) {
  console.log(`\n-> ${step.name}\n`);
  try {
    execFileSync(step.command, step.args, { cwd: root, stdio: "inherit" });
  } catch {
    console.error(`\nValidate failed at: ${step.name}\n`);
    process.exit(1);
  }
}

for (const required of ["dist/index.html", "dist/assets"]) {
  if (!existsSync(join(root, required))) {
    console.error(`\nValidate failed: ${required} missing after build\n`);
    process.exit(1);
  }
}

console.log("\nValidate passed.\n");
