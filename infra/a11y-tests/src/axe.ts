import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type { Result } from "axe-core";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function formatViolations(violations: Result[]): string {
  return violations
    .map((v) => {
      const targets = v.nodes.map((n) => `    - ${n.target.join(" ")}: ${n.failureSummary}`).join("\n");
      return `[${v.impact}] ${v.id} — ${v.help}\n${targets}`;
    })
    .join("\n\n");
}

/** Scans the current page for WCAG 2.1 A/AA violations and throws (with a readable dump) if any are found. */
export async function assertNoWcagViolations(page: Page, context: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  if (results.violations.length > 0) {
    throw new Error(`${context}: ${results.violations.length} WCAG 2.1 AA violation(s)\n\n${formatViolations(results.violations)}`);
  }
}
