import { describe, expect, test } from "bun:test";

import {
  decideSecurityUpdate,
  parseFixPlanIssues,
  securityPullRequestAction,
  shouldCreateSecurityPullRequest,
} from "../../scripts/dependencySecurity";

// Intent: report security-maintenance blockers and gate PR actions on resolution.
describe("dependency security maintenance", () => {
  test("reports blockers and creates a PR only after every advisory is resolved", () => {
    expect(
      parseFixPlanIssues(
        JSON.stringify({
          blocked: [
            {
              name: "transitive-package",
              from: "2.1.0",
              to: "2.1.4",
              blockers: [{ dependent: "parent-package@1.0.0" }],
            },
          ],
          unfixable: [{ name: "unfixable-package", from: "1.0.0" }],
        }),
      ),
    ).toEqual([
      "blocked: transitive-package 2.1.0 → 2.1.4 (blocked by parent-package@1.0.0)",
      "unfixable: unfixable-package 1.0.0 (no published safe version was reported)",
    ]);

    const fixed = decideSecurityUpdate(2, 0, ["bun.lock"]);
    const blocked = decideSecurityUpdate(2, 1, ["bun.lock"]);
    expect(shouldCreateSecurityPullRequest(fixed)).toBe(true);
    expect(securityPullRequestAction(fixed, false)).toBe("create");
    expect(shouldCreateSecurityPullRequest(blocked)).toBe(false);
    expect(securityPullRequestAction(blocked, true)).toBe("skip");
  });
});
