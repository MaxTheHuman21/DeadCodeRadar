/**
 * Property 7: High-Confidence File Filtering (Extended)
 *
 * For any array of EnrichedFinding objects, `getFilesToDelete(findings)` returns a file `f`
 * if and only if:
 *   (a) There exists at least one finding with `file === f`, `type === "unused-file"`,
 *       `confidenceScore === "high"`, OR
 *   (b) ALL findings with `file === f` satisfy: `type === "unused-export"` AND
 *       `confidenceScore === "high"` AND `groupId` is the same non-null value across all of them.
 *
 * Feature: user-github-token-pr-creation, Property 7: High-Confidence File Filtering
 * Validates: Requirements 5.2, 5.7
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { getFilesToDelete } from "../../lambda/prHandler";
import type { EnrichedFinding } from "../../lambda/types";

// Arbitraries for generating EnrichedFinding objects
const findingTypeArb = fc.constantFrom(
  "unused-export" as const,
  "unused-file" as const,
  "unused-dependency" as const
);

const confidenceScoreArb = fc.constantFrom(
  "high" as const,
  "medium" as const,
  "low" as const,
  null
);

const groupIdArb = fc.oneof(
  fc.stringMatching(/^[a-z0-9]{8}$/),
  fc.constant(null)
);

const fileNameArb = fc.stringMatching(/^src\/[a-z]{1,10}\.(ts|js|tsx)$/);

const enrichedFindingArb: fc.Arbitrary<EnrichedFinding> = fc.record({
  file: fileNameArb,
  line: fc.oneof(fc.integer({ min: 1, max: 500 }), fc.constant(null)),
  type: findingTypeArb,
  name: fc.string({ minLength: 1, maxLength: 20 }),
  confidenceScore: confidenceScoreArb,
  riskExplanation: fc.oneof(fc.string({ minLength: 5, maxLength: 50 }), fc.constant(null)),
  groupId: groupIdArb,
});

/**
 * Reference implementation of the expected behavior.
 * This is our oracle — we compare getFilesToDelete against this.
 */
function referenceGetFilesToDelete(findings: EnrichedFinding[]): string[] {
  const byFile = new Map<string, EnrichedFinding[]>();
  for (const f of findings) {
    const group = byFile.get(f.file) ?? [];
    group.push(f);
    byFile.set(f.file, group);
  }

  const eligible: string[] = [];

  for (const [file, fileFindings] of byFile) {
    // Case (a): explicit unused-file with high confidence
    const hasUnusedFileHigh = fileFindings.some(
      (f) => f.type === "unused-file" && f.confidenceScore === "high"
    );
    if (hasUnusedFileHigh) {
      eligible.push(file);
      continue;
    }

    // Case (b): ALL findings are unused-export + high + same non-null groupId
    if (fileFindings.length === 0) continue;

    const allHighExports = fileFindings.every(
      (f) => f.type === "unused-export" && f.confidenceScore === "high"
    );
    if (!allHighExports) continue;

    const firstGroupId = fileFindings[0].groupId;
    if (firstGroupId === null) continue;

    const allSameGroup = fileFindings.every((f) => f.groupId === firstGroupId);
    if (allSameGroup) {
      eligible.push(file);
    }
  }

  return eligible;
}

describe("Property 7: High-Confidence File Filtering (Extended)", () => {
  it("getFilesToDelete matches reference implementation for random findings arrays", () => {
    fc.assert(
      fc.property(
        fc.array(enrichedFindingArb, { minLength: 0, maxLength: 20 }),
        (findings) => {
          const actual = getFilesToDelete(findings).sort();
          const expected = referenceGetFilesToDelete(findings).sort();

          expect(actual).toEqual(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("files with unused-file + high confidence are always included", () => {
    fc.assert(
      fc.property(
        fileNameArb,
        fc.array(enrichedFindingArb, { minLength: 0, maxLength: 10 }),
        (targetFile, otherFindings) => {
          // Create a finding that explicitly marks the file as unused-file + high
          const unusedFileFinding: EnrichedFinding = {
            file: targetFile,
            line: 1,
            type: "unused-file",
            name: "wholeFile",
            confidenceScore: "high",
            riskExplanation: null,
            groupId: null,
          };

          const allFindings = [...otherFindings, unusedFileFinding];
          const result = getFilesToDelete(allFindings);

          expect(result).toContain(targetFile);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("files with only medium/low confidence findings are never included", () => {
    fc.assert(
      fc.property(
        fileNameArb,
        fc.array(
          fc.record({
            file: fc.constant("placeholder"), // will be overwritten
            line: fc.integer({ min: 1, max: 100 }),
            type: fc.constantFrom("unused-export" as const, "unused-file" as const),
            name: fc.string({ minLength: 1, maxLength: 10 }),
            confidenceScore: fc.constantFrom("medium" as const, "low" as const, null),
            riskExplanation: fc.constant(null),
            groupId: fc.constant(null),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (targetFile, findings) => {
          // Override file to targetFile for all findings
          const updatedFindings: EnrichedFinding[] = findings.map((f) => ({
            ...f,
            file: targetFile,
          }));

          const result = getFilesToDelete(updatedFindings);
          expect(result).not.toContain(targetFile);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("files with all unused-export + high + same non-null groupId are included", () => {
    fc.assert(
      fc.property(
        fileNameArb,
        fc.stringMatching(/^[a-z0-9]{8}$/),
        fc.integer({ min: 1, max: 5 }),
        (targetFile, groupId, count) => {
          const findings: EnrichedFinding[] = Array.from({ length: count }, (_, i) => ({
            file: targetFile,
            line: i + 1,
            type: "unused-export" as const,
            name: `export${i}`,
            confidenceScore: "high" as const,
            riskExplanation: null,
            groupId,
          }));

          const result = getFilesToDelete(findings);
          expect(result).toContain(targetFile);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("files with mixed groupIds (all high unused-export) are NOT included", () => {
    fc.assert(
      fc.property(
        fileNameArb,
        fc.stringMatching(/^[a-z0-9]{8}$/),
        fc.stringMatching(/^[a-z0-9]{8}$/).filter((s) => s.length === 8),
        (targetFile, groupId1, groupId2) => {
          fc.pre(groupId1 !== groupId2);

          const findings: EnrichedFinding[] = [
            {
              file: targetFile,
              line: 1,
              type: "unused-export",
              name: "export1",
              confidenceScore: "high",
              riskExplanation: null,
              groupId: groupId1,
            },
            {
              file: targetFile,
              line: 2,
              type: "unused-export",
              name: "export2",
              confidenceScore: "high",
              riskExplanation: null,
              groupId: groupId2,
            },
          ];

          const result = getFilesToDelete(findings);
          expect(result).not.toContain(targetFile);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("empty findings array returns empty result", () => {
    const result = getFilesToDelete([]);
    expect(result).toEqual([]);
  });
});
