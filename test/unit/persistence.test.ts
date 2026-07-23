/**
 * Tests unitarios para el módulo de persistencia — truncamiento de findings.
 * Valida Requirement 4.5: truncar findings cuando el item excede 400KB.
 */

import { describe, it, expect } from "vitest";
import { estimateItemSize, truncateIfNeeded } from "../../lambda/persistence";
import { JobRecord, Finding, EnrichedFinding } from "../../lambda/types";

/** Helper para generar a finding de tamaño aproximado conocido. */
function makeFinding(index: number): EnrichedFinding {
  return {
    file: `src/modules/very/deep/nested/path/component-${index}.ts`,
    line: index,
    type: "unused-export",
    name: `unusedFunction_${index}_withSomeLongNameToIncreaseSize`,
    confidenceScore: null,
    riskExplanation: null,
    groupId: null,
  };
}

/** Helper para crear un JobRecord con N findings. */
function makeRecord(numFindings: number): JobRecord {
  const findings: EnrichedFinding[] = [];
  for (let i = 0; i < numFindings; i++) {
    findings.push(makeFinding(i));
  }
  return {
    jobId: "550e8400-e29b-41d4-a716-446655440000",
    repoUrl: "https://github.com/owner/repo",
    status: "completed",
    findings,
    createdAt: "2024-01-15T10:30:00.000Z",
    filesAnalyzed: 42,
  };
}

describe("estimateItemSize", () => {
  it("should return the byte length of a serialized item", () => {
    const item = { jobId: { S: "abc" }, data: { S: "hello" } };
    const size = estimateItemSize(item);
    expect(size).toBeGreaterThan(0);
    expect(size).toBe(Buffer.byteLength(JSON.stringify(item), "utf-8"));
  });
});

describe("truncateIfNeeded", () => {
  it("should not modify a record that is under the size limit", () => {
    const record = makeRecord(10);
    const originalLength = record.findings.length;

    truncateIfNeeded(record);

    expect(record.findings.length).toBe(originalLength);
    expect(record.truncated).toBeUndefined();
  });

  it("should truncate findings and set truncated=true when item exceeds 380KB", () => {
    // Generate enough findings to exceed 380KB
    // Each finding is roughly ~120 bytes serialized, so ~3500 findings should exceed 380KB
    const record = makeRecord(4000);

    truncateIfNeeded(record);

    expect(record.truncated).toBe(true);
    expect(record.findings.length).toBeLessThan(4000);
    expect(record.findings.length).toBeGreaterThan(0);
  });

  it("should produce a record whose serialized item is ≤ 380KB after truncation", () => {
    const record = makeRecord(5000);

    truncateIfNeeded(record);

    // Build the item the same way saveResult does
    const item: Record<string, any> = {
      jobId: { S: record.jobId },
      repoUrl: { S: record.repoUrl },
      status: { S: record.status },
      findings: { S: JSON.stringify(record.findings) },
      createdAt: { S: record.createdAt },
      filesAnalyzed: { N: String(record.filesAnalyzed) },
      truncated: { BOOL: true },
    };

    const size = estimateItemSize(item);
    expect(size).toBeLessThanOrEqual(380_000);
  });

  it("should preserve findings order (first findings are kept)", () => {
    const record = makeRecord(5000);
    const firstFinding = { ...record.findings[0] };

    truncateIfNeeded(record);

    expect(record.findings[0]).toEqual(firstFinding);
  });

  it("should handle a record with zero findings without error", () => {
    const record = makeRecord(0);

    truncateIfNeeded(record);

    expect(record.findings.length).toBe(0);
    expect(record.truncated).toBeUndefined();
  });

  it("should handle a record just at the boundary", () => {
    // Create a record, check size, then ensure truncation works correctly at the boundary
    const record = makeRecord(3000);

    truncateIfNeeded(record);

    // Whether truncated or not, the resulting item should be within limits
    const item: Record<string, any> = {
      jobId: { S: record.jobId },
      repoUrl: { S: record.repoUrl },
      status: { S: record.status },
      findings: { S: JSON.stringify(record.findings) },
      createdAt: { S: record.createdAt },
      filesAnalyzed: { N: String(record.filesAnalyzed) },
    };
    if (record.truncated) {
      item.truncated = { BOOL: true };
    }

    const size = estimateItemSize(item);
    expect(size).toBeLessThanOrEqual(380_000);
  });
});
