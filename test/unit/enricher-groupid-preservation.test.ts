/**
 * Property 2: Preservation — Findings Sin Grupo Preservan groupId Null
 *
 * These tests verify that the enricher correctly assigns `groupId: null`
 * to findings that legitimately don't belong to any group. This behavior
 * must be preserved after the bugfix.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.5**
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import type { Finding } from "../../lambda/types";

// Mock fs/promises so buildFileContext doesn't hit the real filesystem
vi.mock("fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue("// mock file content\n"),
}));

// We'll store the bedrock response to return from the mock
let bedrockResponseToReturn: string | Error = "";

// Mock the AWS SDK client so invokeBedrockWithTimeout doesn't make real calls
vi.mock("@aws-sdk/client-bedrock-runtime", () => {
  return {
    BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
      send: vi.fn().mockImplementation(async () => {
        if (bedrockResponseToReturn instanceof Error) {
          throw bedrockResponseToReturn;
        }
        return {
          body: new TextEncoder().encode(
            JSON.stringify({
              content: [{ text: bedrockResponseToReturn }],
            })
          ),
        };
      }),
    })),
    InvokeModelCommand: vi.fn().mockImplementation((input) => input),
  };
});

import { enrichFindings } from "../../lambda/enricher";

/**
 * Helper: Generate a Finding with a unique file path based on index.
 * Files are named so that sorting alphabetically gives a predictable order.
 */
function makeFinding(index: number): Finding {
  const paddedIdx = String(index).padStart(4, "0");
  return {
    file: `src/file-${paddedIdx}.ts`,
    line: index + 1,
    type: "unused-export",
    name: `export_${paddedIdx}`,
  };
}

/**
 * Helper: Build a valid Bedrock JSON response where all findings have groupId: null.
 */
function buildBedrockResponseAllNull(count: number): string {
  const findings = Array.from({ length: count }, (_, i) => ({
    index: i,
    confidenceScore: "medium",
    riskExplanation: "Unused export with no consumers.",
    groupId: null,
  }));
  return JSON.stringify({
    findings,
    prDescription: {
      title: "chore: remove dead code",
      body: "## Summary\n\nRemove unused exports.",
    },
  });
}

/**
 * Helper: Build a Bedrock response where some findings within selected have
 * groupIds, but those files do NOT appear in remaining (since all files are unique).
 */
function buildBedrockResponseGroupedInSelectedOnly(
  selectedCount: number,
  groupedIndices: number[]
): string {
  const findings = Array.from({ length: selectedCount }, (_, i) => ({
    index: i,
    confidenceScore: "high",
    riskExplanation: "No incoming imports.",
    groupId: groupedIndices.includes(i) ? "grp12345" : null,
  }));
  return JSON.stringify({
    findings,
    prDescription: {
      title: "chore: remove dead code",
      body: "## Summary\n\nRemove unused exports.",
    },
  });
}

describe("Property 2: Preservation — Findings Sin Grupo Preservan groupId Null", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("≤50 findings with all groupId:null from Bedrock → all output findings have groupId:null", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }),
        async (numFindings) => {
          // Create findings with unique file paths
          const findings: Finding[] = Array.from({ length: numFindings }, (_, i) =>
            makeFinding(i)
          );

          // Set Bedrock response: all groupId: null
          bedrockResponseToReturn = buildBedrockResponseAllNull(numFindings);

          const result = await enrichFindings({ findings, tmpDir: "/tmp/test" });

          // Assert: all findings should have groupId: null
          expect(result.findings).toHaveLength(numFindings);
          for (const f of result.findings) {
            expect(f.groupId).toBeNull();
          }
          expect(result.enriched).toBe(true);
        }
      ),
      { numRuns: 30 }
    );
  }, 30000);

  it(">50 findings where Bedrock assigns no groupIds → remaining findings have groupId:null", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 51, max: 100 }),
        async (numFindings) => {
          // Create findings with unique file paths (no file overlap between selected/remaining)
          const findings: Finding[] = Array.from({ length: numFindings }, (_, i) =>
            makeFinding(i)
          );

          // Bedrock response: only covers first 50 (selected), all with groupId: null
          bedrockResponseToReturn = buildBedrockResponseAllNull(50);

          const result = await enrichFindings({ findings, tmpDir: "/tmp/test" });

          // Assert: all findings should have groupId: null
          expect(result.findings).toHaveLength(numFindings);
          for (const f of result.findings) {
            expect(f.groupId).toBeNull();
          }
          expect(result.enriched).toBe(true);
        }
      ),
      { numRuns: 30 }
    );
  }, 30000);

  it(">50 findings where groups exist only within selected (files don't appear in remaining) → remaining have groupId:null", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 51, max: 100 }),
        fc.array(fc.integer({ min: 0, max: 49 }), { minLength: 2, maxLength: 5 }),
        async (numFindings, groupedIndices) => {
          // Create findings with UNIQUE file paths — no file overlap selected/remaining
          const findings: Finding[] = Array.from({ length: numFindings }, (_, i) =>
            makeFinding(i)
          );

          // Bedrock groups some findings within selected, but those files
          // are unique and don't appear in remaining
          const uniqueGrouped = [...new Set(groupedIndices)];
          bedrockResponseToReturn = buildBedrockResponseGroupedInSelectedOnly(50, uniqueGrouped);

          const result = await enrichFindings({ findings, tmpDir: "/tmp/test" });

          expect(result.findings).toHaveLength(numFindings);

          // Remaining findings (positions ≥50 in output) should have groupId: null
          // because their files are unique and don't match any grouped selected finding
          const remainingFindings = result.findings.slice(50);
          for (const f of remainingFindings) {
            expect(f.groupId).toBeNull();
          }
          expect(result.enriched).toBe(true);
        }
      ),
      { numRuns: 30 }
    );
  }, 30000);

  it("Bedrock failure (fallback) → all findings get groupId:null", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }),
        async (numFindings) => {
          const findings: Finding[] = Array.from({ length: numFindings }, (_, i) =>
            makeFinding(i)
          );

          // Mock Bedrock to throw an error (simulating timeout/failure)
          bedrockResponseToReturn = new Error("Bedrock timeout");

          const result = await enrichFindings({ findings, tmpDir: "/tmp/test" });

          // Assert: fallback → all findings get groupId: null, enriched: false
          expect(result.findings).toHaveLength(numFindings);
          for (const f of result.findings) {
            expect(f.groupId).toBeNull();
          }
          expect(result.enriched).toBe(false);
          expect(result.prDescription).toBeNull();
        }
      ),
      { numRuns: 30 }
    );
  }, 30000);
});
