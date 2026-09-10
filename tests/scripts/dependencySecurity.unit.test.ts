import { describe, expect, test } from "bun:test";

import {
  decideSecurityUpdate,
  parseFixPlanIssues,
  securityPullRequestAction,
  shouldCreateSecurityPullRequest,
} from "../../scripts/dependencySecurity";

// Intent: report security-maintenance blockers and gate PR actions on resolution.
// Growth boundary: add cases only for new status or action paths.
describe("dependency security maintenance", () => {
  test("reports blocked targeted fixes without hiding the reason", () => {
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
  });

  test("creates a PR only after every advisory is resolved", () => {
    const noUpdates = decideSecurityUpdate(0, 0, []);
    const fixed = decideSecurityUpdate(2, 0, ["bun.lock"]);
    const blocked = decideSecurityUpdate(2, 1, ["bun.lock"]);

    expect(noUpdates.status).toBe("no-updates");
    expect(shouldCreateSecurityPullRequest(noUpdates)).toBe(false);
    expect(fixed.status).toBe("fixed");
    expect(shouldCreateSecurityPullRequest(fixed)).toBe(true);
    expect(securityPullRequestAction(fixed, false)).toBe("create");
    expect(securityPullRequestAction(fixed, true)).toBe("update");
    expect(blocked.status).toBe("blocked");
    expect(shouldCreateSecurityPullRequest(blocked)).toBe(false);
    expect(securityPullRequestAction(blocked, true)).toBe("skip");
  });
});
