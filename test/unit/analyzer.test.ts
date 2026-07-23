import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AppError, ErrorType } from "../../lambda/errors";

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "child_process";

const mockedExecSync = vi.mocked(execSync);

// Sample knip JSON output — uses the REAL knip --reporter json format
const sampleKnipOutput = JSON.stringify({
  files: ["src/unused-file.ts"],
  issues: [
    {
      file: "package.json",
      dependencies: [{ name: "lodash" }],
      devDependencies: [],
      optionalPeerDependencies: [],
      unlisted: [],
      binaries: [],
      unresolved: [],
      exports: [],
      types: [],
      enumMembers: {},
      duplicates: [],
    },
    {
      file: "src/utils.ts",
      dependencies: [],
      devDependencies: [],
      optionalPeerDependencies: [],
      unlisted: [],
      binaries: [],
      unresolved: [],
      exports: [{ name: "helperFn", line: 10, col: 14, pos: 200 }],
      types: [],
      enumMembers: {},
      duplicates: [],
    },
  ],
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

  describe("Real knip JSON format parsing", () => {
    it("parses actual knip --reporter json output with nested issues containing dependencies and exports", async () => {
      // This mirrors the REAL output from `npx knip --reporter json`
      const realKnipOutput = JSON.stringify({
        files: ["bin/app.ts", "lambda/utils/legacyDateFormatter.ts"],
        issues: [
          {
            file: "package.json",
            dependencies: [{ name: "aws-cdk-lib" }, { name: "constructs" }, { name: "lodash" }],
            devDependencies: [{ name: "ts-node" }],
            optionalPeerDependencies: [],
            unlisted: [],
            binaries: [],
            unresolved: [],
            exports: [],
            types: [],
            enumMembers: {},
            duplicates: [],
          },
          {
            file: "lambda/enricher.ts",
            dependencies: [],
            devDependencies: [],
            optionalPeerDependencies: [],
            unlisted: [],
            binaries: [],
            unresolved: [],
            exports: [
              { name: "MAX_CONTEXT_CHARS", line: 43, col: 14, pos: 1544 },
              { name: "buildPromptMessages", line: 51, col: 17, pos: 1822 },
            ],
            types: [
              { name: "FindingWithContext", line: 36, col: 18, pos: 1377 },
            ],
            enumMembers: {},
            duplicates: [],
          },
          {
            file: "lambda/downloader.ts",
            dependencies: [],
            devDependencies: [],
            optionalPeerDependencies: [],
            unlisted: [{ name: "@octokit/request-error" }],
            binaries: [],
            unresolved: [],
            exports: [],
            types: [],
            enumMembers: {},
            duplicates: [],
          },
        ],
      });

      const error = Object.assign(new Error("Command failed"), {
        stdout: realKnipOutput,
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

      // Verify unused files from top-level "files" array
      const unusedFiles = result.findings.filter((f) => f.type === "unused-file");
      expect(unusedFiles.length).toBe(2);
      expect(unusedFiles.map((f) => f.file)).toContain("bin/app.ts");
      expect(unusedFiles.map((f) => f.file)).toContain("lambda/utils/legacyDateFormatter.ts");

      // Verify unused dependencies from issues[0].dependencies
      const unusedDeps = result.findings.filter((f) => f.type === "unused-dependency");
      expect(unusedDeps.length).toBe(5); // 3 deps + 1 devDep + 1 unlisted
      const depNames = unusedDeps.map((f) => f.name);
      expect(depNames).toContain("aws-cdk-lib");
      expect(depNames).toContain("constructs");
      expect(depNames).toContain("lodash");
      expect(depNames).toContain("ts-node");
      expect(depNames).toContain("@octokit/request-error");
      // All dep findings should reference package.json
      for (const dep of unusedDeps) {
        expect(dep.file).toBe("package.json");
      }

      // Verify unused exports from issues[1].exports and issues[1].types
      const unusedExports = result.findings.filter((f) => f.type === "unused-export");
      expect(unusedExports.length).toBe(3); // 2 exports + 1 type
      const exportNames = unusedExports.map((f) => f.name);
      expect(exportNames).toContain("MAX_CONTEXT_CHARS");
      expect(exportNames).toContain("buildPromptMessages");
      expect(exportNames).toContain("FindingWithContext");

      // Verify export findings reference the correct file
      const maxContextFinding = unusedExports.find((f) => f.name === "MAX_CONTEXT_CHARS");
      expect(maxContextFinding!.file).toBe("lambda/enricher.ts");
      expect(maxContextFinding!.line).toBe(43);

      const typeFinding = unusedExports.find((f) => f.name === "FindingWithContext");
      expect(typeFinding!.file).toBe("lambda/enricher.ts");
      expect(typeFinding!.line).toBe(36);
    });
  });
});
