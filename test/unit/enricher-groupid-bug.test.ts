/**
 * Bug Condition Exploration Test: GroupId Perdido en Remaining
 *
 * This test demonstrates the bug where findings in the `remaining` partition
 * (beyond the first 50 selected for enrichment) ALWAYS receive `groupId: null`,
 * even when they share the same file as a grouped finding in `selected`.
 *
 * EXPECTED: This test FAILS on unfixed code, proving the bug exists.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import type { Finding, EnrichedFinding } from "../../lambda/types";

// Mock fs/promises to avoid filesystem access
vi.mock("fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue("// mock file content\nexport const x = 1;\n"),
}));

// Mock the Bedrock client
vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  InvokeModelCommand: vi.fn(),
}));

import { enrichFindings, selectFindingsForEnrichment, MAX_ENRICHMENT_FINDINGS } from "../../lambda/enricher";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

/**
 * Helper: Create findings sorted alphabetically by file where some share a file
 * across the selected/remaining boundary.
 *
 * Strategy: Generate `totalCount` findings. The finding at sorted position
 * `groupedIndexInSelected` (within selected, 0-49) uses a "shared" file.
 * Findings at position >= 50 (remaining) also use this same "shared" file.
 */
function createFindings(
  totalCount: number,
  groupedIndexInSelected: number
): Finding[] {
  // We need to carefully construct findings so that after sorting by file:
  // - Position `groupedIndexInSelected` in selected has the shared file
  // - At least one finding in remaining has the same shared file
  //
  // Naming strategy for alphabetical ordering:
  // - "aaa_NNN.ts" sorts before "shared_target.ts"
  // - "zzz_NNN.ts" sorts after "shared_target.ts"
  const findings: Finding[] = [];
  const sharedFile = "shared_target.ts";

  // Fill positions 0..groupedIndexInSelected-1 with files that sort BEFORE sharedFile
  for (let i = 0; i < groupedIndexInSelected; i++) {
    const padded = String(i).padStart(4, "0");
    findings.push({
      file: `aaa_${padded}.ts`,
      line: i + 1,
      type: "unused-export",
      name: `export_before_${i}`,
    });
  }

  // Position groupedIndexInSelected: the shared file (in selected)
  findings.push({
    file: sharedFile,
    line: 10,
    type: "unused-export",
    name: "export_shared_selected",
  });

  // Fill positions groupedIndexInSelected+1..49 with files that sort AFTER sharedFile
  for (let i = groupedIndexInSelected + 1; i < MAX_ENRICHMENT_FINDINGS; i++) {
    const padded = String(i).padStart(4, "0");
    findings.push({
      file: `zzz_${padded}.ts`,
      line: i + 1,
      type: "unused-export",
      name: `export_after_${i}`,
    });
  }

  // Fill remaining positions (50+) with the SAME shared file (different lines/names)
  for (let i = MAX_ENRICHMENT_FINDINGS; i < totalCount; i++) {
    findings.push({
      file: sharedFile,
      line: (i + 1) * 10,
      type: "unused-export",
      name: `export_remaining_${i}`,
    });
  }

  // The findings are already in sorted order by file due to our naming convention
  // aaa_* < shared_target.ts < zzz_*
  // And the shared_target.ts entries at the end are after zzz_*, BUT we need them
  // to sort correctly. Let's just sort them.
  findings.sort((a, b) => a.file.localeCompare(b.file));

  return findings;
}

/**
 * Build a mock Bedrock JSON response that assigns a groupId to the finding
 * at `targetIndex` within the selected partition (first 50 sorted findings).
 */
function buildMockBedrockResponseJson(
  selectedCount: number,
  targetIndex: number,
  groupId: string
): string {
  const responseFindings = [];
  for (let i = 0; i < selectedCount; i++) {
    responseFindings.push({
      index: i,
      confidenceScore: "high",
      riskExplanation: "Dead code detected.",
      groupId: i === targetIndex ? groupId : null,
    });
  }

  return JSON.stringify({
    findings: responseFindings,
    prDescription: {
      title: "chore: remove dead code",
      body: "## Summary\n\nRemove dead code findings.",
    },
  });
}

/**
 * Configure the mocked BedrockRuntimeClient to return a specific response.
 */
function setupBedrockMock(responseJson: string): void {
  const mockSend = vi.fn().mockResolvedValue({
    body: new TextEncoder().encode(
      JSON.stringify({
        content: [{ text: responseJson }],
      })
    ),
  });

  (BedrockRuntimeClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    send: mockSend,
  }));
}

describe("Bug Condition: GroupId Perdido en Remaining", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("property: remaining findings sharing file with grouped selected finding should inherit groupId", async () => {
    const GROUP_ID = "abcd1234";

    await fc.assert(
      fc.asyncProperty(
        // Total findings: 51-80 (ensures at least 1 in remaining)
        fc.integer({ min: 51, max: 80 }),
        // Position of the grouped finding in selected: 0-49
        fc.integer({ min: 0, max: 49 }),
        async (totalCount, groupedIndexInSelected) => {
          // Create findings with cross-boundary shared file
          const findings = createFindings(totalCount, groupedIndexInSelected);

          // Verify our setup: after sorting, the shared file should appear in both partitions
          const { selected, remaining } = selectFindingsForEnrichment(findings);
          const sharedFile = "shared_target.ts";

          const targetInSelected = selected.findIndex((f) => f.file === sharedFile);
          const hasInRemaining = remaining.some((f) => f.file === sharedFile);

          // Skip if setup doesn't produce the expected configuration
          if (targetInSelected === -1 || !hasInRemaining) return;

          // Setup Bedrock mock to assign groupId to the target finding
          const responseJson = buildMockBedrockResponseJson(
            selected.length,
            targetInSelected,
            GROUP_ID
          );
          setupBedrockMock(responseJson);

          // Run the enricher
          const result = await enrichFindings({
            findings,
            tmpDir: "/tmp/fake",
          });

          // Assert: ALL findings with the shared file should have the groupId
          const findingsWithSharedFile = result.findings.filter(
            (f) => f.file === sharedFile
          );

          // At least one finding with the shared file should exist in the output
          expect(findingsWithSharedFile.length).toBeGreaterThan(1);

          // The selected finding should have the groupId (Bedrock assigned it)
          const withGroupId = findingsWithSharedFile.filter(
            (f) => f.groupId === GROUP_ID
          );
          expect(withGroupId.length).toBeGreaterThanOrEqual(1);

          // BUG ASSERTION: Remaining findings with the shared file should ALSO
          // have the groupId propagated. On unfixed code, they get null.
          for (const f of findingsWithSharedFile) {
            expect(f.groupId).toBe(GROUP_ID);
          }
        }
      ),
      { numRuns: 50, verbose: true }
    );
  }, 60_000);

  it("example: finding at index 48 (selected) grouped, finding 51+ (remaining) shares file → remaining should get groupId", async () => {
    const GROUP_ID = "abcd1234";
    const TOTAL_FINDINGS = 55;
    const GROUPED_INDEX = 48;

    // Create 55 findings where finding at sorted position 48 shares file with remaining findings
    const findings = createFindings(TOTAL_FINDINGS, GROUPED_INDEX);

    // Verify the setup
    const { selected, remaining } = selectFindingsForEnrichment(findings);
    const sharedFile = "shared_target.ts";
    const targetInSelected = selected.findIndex((f) => f.file === sharedFile);

    expect(targetInSelected).toBe(GROUPED_INDEX);
    expect(remaining.some((f) => f.file === sharedFile)).toBe(true);

    // Setup Bedrock mock
    const responseJson = buildMockBedrockResponseJson(
      selected.length,
      targetInSelected,
      GROUP_ID
    );
    setupBedrockMock(responseJson);

    // Run the enricher
    const result = await enrichFindings({
      findings,
      tmpDir: "/tmp/fake",
    });

    // Get all findings with the shared file in the result
    const findingsWithSharedFile = result.findings.filter(
      (f) => f.file === sharedFile
    );

    // Should have multiple findings with the shared file (1 from selected + N from remaining)
    expect(findingsWithSharedFile.length).toBe(6); // 1 selected + 5 remaining (55-50)

    // The selected finding should have the groupId
    const selectedGrouped = findingsWithSharedFile.find(
      (f) => f.groupId === GROUP_ID
    );
    expect(selectedGrouped).toBeDefined();

    // BUG: Remaining findings with the same file get groupId: null instead of GROUP_ID
    const remainingFindings = findingsWithSharedFile.filter(
      (f) => f.name !== "export_shared_selected"
    );
    expect(remainingFindings.length).toBeGreaterThan(0);

    // This assertion WILL FAIL on unfixed code - proving the bug exists.
    // Remaining findings should inherit the groupId from their file-mate in selected.
    for (const f of remainingFindings) {
      expect(f.groupId).toBe(GROUP_ID);
    }
  }, 30_000);
});
