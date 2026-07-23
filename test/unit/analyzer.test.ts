import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AppError, ErrorType } from "../../lambda/errors";

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "child_process";

const mockedExecSync = vi.mocked(execSync);

// Sample knip JSON output
const sampleKnipOutput = JSON.stringify({
  files: ["src/unused-file.ts"],
  exports: [{ file: "src/utils.ts", name: "helperFn", line: 10 }],
  dependencies: [{ name: "lodash", file: "package.json" }],
});

// We need to control require.resolve to simulate binary resolution.
// The analyzer uses require.resolve("knip/bin/knip.js") and require.resolve("ts-prune/lib/index.js").
const originalRequireResolve = require.resolve;

describe("analyzeDeadCode", () => {
  let resolveMap: Record<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    // Default: both binaries resolvable
    resolveMap = {
      "knip/bin/knip.js": "/fake/node_modules/knip/bin/knip.js",
      "ts-prune/lib/index.js": "/fake/node_modules/ts-prune/lib/index.js",
    };

    // Override require.resolve to return fake paths for knip/ts-prune
    (require as NodeJS.Require & { resolve: typeof require.resolve }).resolve = Object.assign(
      ((id: string, options?: { paths?: string[] }) => {
        if (resolveMap[id]) return resolveMap[id];
        return originalRequireResolve(id, options);
      }) as typeof require.resolve,
      { paths: originalRequireResolve.paths }
    );
  });

  afterEach(() => {
    // Restore original require.resolve
    (require as NodeJS.Require & { resolve: typeof require.resolve }).resolve = originalRequireResolve;
  });

  describe("Knip succeeds with findings", () => {
    it("returns AnalysisResult with engineUsed: 'knip' when knip succeeds", async () => {
      // knip exits with code 1 when findings found - execSync throws
      const error = Object.assign(new Error("Command failed"), {
        stdout: sampleKnipOutput,
        stderr: "",
        status: 1,
        signal: null,
        killed: false,
      });
      mockedExecSync.mockImplementation(() => {
        throw error;
      });

      const { analyzeDeadCode } = await import("../../lambda/analyzer");
      const result = await analyzeDeadCode("/tmp/test-repo");

      expect(result.engineUsed).toBe("knip");
      expect(result.findings.length).toBeGreaterThan(0);
    });

    it("parses knip output correctly: files → unused-file, exports → unused-export, dependencies → unused-dependency", async () => {
      const error = Object.assign(new Error("Command failed"), {
        stdout: sampleKnipOutput,
        stderr: "",
        status: 1,
        signal: null,
        killed: false,
      });
      mockedExecSync.mockImplementation(() => {
        throw error;
      });

      const { analyzeDeadCode } = await import("../../lambda/analyzer");
      const result = await analyzeDeadCode("/tmp/test-repo");

      // Verify structure: each finding has file, line, type, name
      for (const finding of result.findings) {
        expect(finding).toHaveProperty("file");
        expect(finding).toHaveProperty("line");
        expect(finding).toHaveProperty("type");
        expect(finding).toHaveProperty("name");
      }

      // Verify unused-file from "files" array
      const unusedFile = result.findings.find((f) => f.type === "unused-file");
      expect(unusedFile).toBeDefined();
      expect(unusedFile!.file).toBe("src/unused-file.ts");
      expect(unusedFile!.name).toBe("unused-file.ts");

      // Verify unused-export from "exports" array
      const unusedExport = result.findings.find((f) => f.type === "unused-export");
      expect(unusedExport).toBeDefined();
      expect(unusedExport!.file).toBe("src/utils.ts");
      expect(unusedExport!.name).toBe("helperFn");
      expect(unusedExport!.line).toBe(10);

      // Verify unused-dependency from "dependencies" array
      const unusedDep = result.findings.find((f) => f.type === "unused-dependency");
      expect(unusedDep).toBeDefined();
      expect(unusedDep!.file).toBe("package.json");
      expect(unusedDep!.name).toBe("lodash");
    });
  });

  describe("Fallback to ts-prune when knip fails", () => {
    it("falls back to ts-prune when knip fails with a non-timeout error", async () => {
      mockedExecSync.mockImplementation((cmd) => {
        if (String(cmd).includes("knip")) {
          // knip fails with a real error (no stdout, has stderr)
          throw Object.assign(new Error("knip crashed"), {
            stdout: "",
            stderr: "Some internal knip error",
            status: 2,
            signal: null,
            killed: false,
          });
        }
        // ts-prune succeeds with output
        return "src/helper.ts:5 - unusedFunc\n";
      });

      const { analyzeDeadCode } = await import("../../lambda/analyzer");
      const result = await analyzeDeadCode("/tmp/test-repo");

      expect(result.engineUsed).toBe("ts-prune");
      expect(result.findings.length).toBe(1);
      expect(result.findings[0].file).toBe("src/helper.ts");
      expect(result.findings[0].line).toBe(5);
      expect(result.findings[0].type).toBe("unused-export");
      expect(result.findings[0].name).toBe("unusedFunc");
    });
  });

  describe("Both engines fail", () => {
    it("throws AppError with ANALYSIS_ENGINE_FAILED when both knip and ts-prune fail", async () => {
      mockedExecSync.mockImplementation(() => {
        throw Object.assign(new Error("Engine failed"), {
          stdout: "",
          stderr: "fatal error",
          status: 2,
          signal: null,
          killed: false,
        });
      });

      const { analyzeDeadCode } = await import("../../lambda/analyzer");

      try {
        await analyzeDeadCode("/tmp/test-repo");
        expect.fail("Should have thrown");
      } catch (e: unknown) {
        const err = e as { name: string; type: string; message: string };
        expect(err.name).toBe("AppError");
        expect(err.type).toBe(ErrorType.ANALYSIS_ENGINE_FAILED);
        expect(err.message).toContain("Both engines failed");
      }
    });
  });

  describe("Timeout handling", () => {
    it("throws AppError with ANALYSIS_ENGINE_FAILED when both engines timeout within budget", async () => {
      mockedExecSync.mockImplementation(() => {
        throw Object.assign(new Error("Command timed out"), {
          stdout: "",
          stderr: "",
          status: null,
          signal: "SIGTERM",
          killed: true,
        });
      });

      const { analyzeDeadCode } = await import("../../lambda/analyzer");

      try {
        await analyzeDeadCode("/tmp/test-repo");
        expect.fail("Should have thrown");
      } catch (e: unknown) {
        const err = e as { name: string; type: string; message: string };
        expect(err.name).toBe("AppError");
        expect(err.type).toBe(ErrorType.ANALYSIS_ENGINE_FAILED);
        expect(err.message).toContain("knip + ts-prune excedieron 180s combinados");
      }
    });

    it("throws ANALYSIS_TIMEOUT from knip and falls back to ts-prune successfully", async () => {
      mockedExecSync.mockImplementation((cmd) => {
        if (String(cmd).includes("knip")) {
          throw Object.assign(new Error("Command timed out"), {
            stdout: "",
            stderr: "",
            status: null,
            signal: "SIGTERM",
            killed: true,
          });
        }
        // ts-prune succeeds
        return "src/helper.ts:5 - unusedFunc\n";
      });

      const { analyzeDeadCode } = await import("../../lambda/analyzer");
      const result = await analyzeDeadCode("/tmp/test-repo");

      expect(result.engineUsed).toBe("ts-prune");
      expect(result.findings.length).toBe(1);
      expect(result.findings[0].name).toBe("unusedFunc");
    });
  });

  describe("Budget constants are exported", () => {
    it("exports ANALYSIS_BUDGET_MS = 180_000 and KNIP_TIMEOUT_MS = 120_000", async () => {
      const { ANALYSIS_BUDGET_MS, KNIP_TIMEOUT_MS } = await import("../../lambda/analyzer");
      expect(ANALYSIS_BUDGET_MS).toBe(180_000);
      expect(KNIP_TIMEOUT_MS).toBe(120_000);
    });
  });
});
