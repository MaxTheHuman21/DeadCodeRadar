/**
 * Motor de análisis de código muerto para DeadCode Radar.
 * Ejecuta knip como motor principal y ts-prune como fallback.
 * Los binarios se resuelven directamente del node_modules (sin npx).
 */

import { execSync } from "child_process";
import * as path from "path";
import { Finding, AnalysisResult } from "./types";
import { AppError, ErrorType } from "./errors";

/** Presupuesto GLOBAL para toda la fase de análisis (knip + fallback combinados). */
export const ANALYSIS_BUDGET_MS = 180_000;

/** Porción del presupuesto asignada a knip como motor primario. */
export const KNIP_TIMEOUT_MS = 120_000;

/**
 * Intenta resolver la ruta al binario de knip.
 * Prueba múltiples estrategias de resolución.
 */
function resolveKnipBin(): string | null {
  // Estrategia 1: require.resolve del bin declarado
  try {
    return require.resolve("knip/bin/knip.js");
  } catch {
    // ignore
  }

  // Estrategia 2: Buscar desde el package.json de knip
  try {
    const knipPkgPath = require.resolve("knip/package.json");
    const knipDir = path.dirname(knipPkgPath);
    const knipPkg = require(knipPkgPath);
    const binEntry =
      typeof knipPkg.bin === "string"
        ? knipPkg.bin
        : knipPkg.bin?.knip;
    if (binEntry) {
      return path.resolve(knipDir, binEntry);
    }
  } catch {
    // ignore
  }

  // Estrategia 3: Path convencional en node_modules/.bin
  try {
    const candidate = path.join(
      process.cwd(),
      "node_modules",
      ".bin",
      "knip"
    );
    // Verificar existencia leyendo el link
    require("fs").accessSync(candidate, require("fs").constants.X_OK);
    return candidate;
  } catch {
    // ignore
  }

  return null;
}

/**
 * Intenta resolver la ruta al binario de ts-prune.
 * Prueba múltiples estrategias de resolución.
 */
function resolveTsPruneBin(): string | null {
  // Estrategia 1: require.resolve del entry point
  try {
    return require.resolve("ts-prune/lib/index.js");
  } catch {
    // ignore
  }

  // Estrategia 2: Buscar desde el package.json de ts-prune
  try {
    const tsPrunePkgPath = require.resolve("ts-prune/package.json");
    const tsPruneDir = path.dirname(tsPrunePkgPath);
    const tsPrunePkg = require(tsPrunePkgPath);
    const binEntry =
      typeof tsPrunePkg.bin === "string"
        ? tsPrunePkg.bin
        : tsPrunePkg.bin?.["ts-prune"];
    if (binEntry) {
      return path.resolve(tsPruneDir, binEntry);
    }
  } catch {
    // ignore
  }

  // Estrategia 3: Path convencional en node_modules/.bin
  try {
    const candidate = path.join(
      process.cwd(),
      "node_modules",
      ".bin",
      "ts-prune"
    );
    require("fs").accessSync(candidate, require("fs").constants.X_OK);
    return candidate;
  } catch {
    // ignore
  }

  return null;
}

/**
 * Mapea los tipos de hallazgos de knip al enum de Finding.
 * Knip reporta tipos como "exports", "files", "dependencies", "unlisted", etc.
 */
function mapKnipType(knipType: string): Finding["type"] | null {
  const mapping: Record<string, Finding["type"]> = {
    exports: "unused-export",
    types: "unused-export",
    nsExports: "unused-export",
    nsTypes: "unused-export",
    enumMembers: "unused-export",
    classMembers: "unused-export",
    duplicates: "unused-export",
    files: "unused-file",
    dependencies: "unused-dependency",
    devDependencies: "unused-dependency",
    optionalPeerDependencies: "unused-dependency",
    unlisted: "unused-dependency",
    binaries: "unused-dependency",
  };
  return mapping[knipType] ?? null;
}

/**
 * Parsea el output JSON de knip y transforma a array de Finding.
 * El formato JSON de knip con --reporter json es un objeto con claves
 * por tipo de issue, cada una conteniendo un array de hallazgos.
 */
function parseKnipOutput(jsonOutput: string): Finding[] {
  const findings: Finding[] = [];

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonOutput);
  } catch {
    return findings;
  }

  // Knip JSON reporter format: { files: [...], exports: [...], ... }
  for (const [issueType, issues] of Object.entries(parsed)) {
    const findingType = mapKnipType(issueType);
    if (!findingType || !Array.isArray(issues)) continue;

    for (const issue of issues) {
      if (issueType === "files") {
        // Files entries are strings (file paths) or objects with path
        const filePath = typeof issue === "string" ? issue : issue?.path ?? issue?.file;
        if (filePath) {
          findings.push({
            file: filePath,
            line: null,
            type: "unused-file",
            name: path.basename(filePath),
          });
        }
      } else if (issueType === "dependencies" || issueType === "devDependencies" ||
                 issueType === "optionalPeerDependencies" || issueType === "unlisted" ||
                 issueType === "binaries") {
        // Dependency entries have name and possibly file location
        const depName = issue?.name ?? issue;
        const depFile = issue?.file ?? issue?.filePath ?? "package.json";
        if (depName) {
          findings.push({
            file: typeof depFile === "string" ? depFile : "package.json",
            line: issue?.line ?? issue?.col ?? null,
            type: "unused-dependency",
            name: typeof depName === "string" ? depName : String(depName),
          });
        }
      } else {
        // Export-type entries: have name, file/path, line/pos
        const symbolName = issue?.name ?? issue?.symbol ?? "unknown";
        const filePath = issue?.file ?? issue?.path ?? issue?.filePath ?? "unknown";
        const line = issue?.line ?? issue?.row ?? issue?.pos ?? null;
        findings.push({
          file: typeof filePath === "string" ? filePath : "unknown",
          line: typeof line === "number" ? line : null,
          type: findingType,
          name: typeof symbolName === "string" ? symbolName : String(symbolName),
        });
      }
    }
  }

  return findings;
}

/**
 * Parsea el output texto de ts-prune y transforma a array de Finding.
 * ts-prune output format: "filePath:line - symbolName"
 */
function parseTsPruneOutput(textOutput: string): Finding[] {
  const findings: Finding[] = [];
  const lines = textOutput.split("\n").filter((l) => l.trim().length > 0);

  for (const line of lines) {
    // Format: "src/file.ts:42 - exportName"
    const match = line.match(/^(.+?):(\d+)\s+-\s+(.+)$/);
    if (match) {
      const [, file, lineNum, name] = match;
      // ts-prune marks "(used in module)" for re-exports — skip those
      if (name.includes("(used in module)")) continue;

      findings.push({
        file: file.trim(),
        line: parseInt(lineNum, 10),
        type: "unused-export",
        name: name.trim(),
      });
    }
  }

  return findings;
}

/**
 * Ejecuta knip como subproceso y retorna los findings.
 * Lanza error si knip no puede ejecutarse (no si encuentra código muerto).
 * Lanza AppError con ANALYSIS_TIMEOUT si el proceso es matado por timeout.
 */
function runKnip(knipBin: string, tmpDir: string, timeoutMs: number): Finding[] {
  try {
    const result = execSync(`node "${knipBin}" --reporter json`, {
      cwd: tmpDir,
      timeout: timeoutMs,
      encoding: "utf-8",
      // knip exits with code 1 when findings exist — capture all output
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return parseKnipOutput(result);
  } catch (error: unknown) {
    // execSync throws on non-zero exit code. 
    // knip exits 1 when dead code is found — this is expected behavior.
    const execError = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      status?: number | null;
      signal?: string | null;
      killed?: boolean;
    };

    const stdout = execError.stdout
      ? typeof execError.stdout === "string"
        ? execError.stdout
        : execError.stdout.toString("utf-8")
      : "";

    const stderr = execError.stderr
      ? typeof execError.stderr === "string"
        ? execError.stderr
        : execError.stderr.toString("utf-8")
      : "";

    // If we got JSON output in stdout, knip ran successfully but found issues (exit 1)
    if (stdout && stdout.trim().startsWith("{")) {
      return parseKnipOutput(stdout);
    }

    // If killed by signal or timeout, map to ANALYSIS_TIMEOUT (504)
    if (execError.signal || execError.killed) {
      throw new AppError(
        ErrorType.ANALYSIS_TIMEOUT,
        `Tiempo de análisis excedido para este repositorio (knip killed by signal: ${execError.signal ?? "SIGTERM"})`,
        error instanceof Error ? error : undefined
      );
    }

    // Exit code 1 with no stdout but with stderr indicates a real error
    if (!stdout && stderr) {
      throw new Error(`knip failed: ${stderr.substring(0, 500)}`);
    }

    // Exit code 1 with empty output — no findings
    if (execError.status === 1 && !stdout) {
      return [];
    }

    throw new Error(
      `knip failed with exit code ${execError.status}: ${stderr.substring(0, 500)}`
    );
  }
}

/**
 * Ejecuta ts-prune como subproceso y retorna los findings.
 * Lanza error si ts-prune no puede ejecutarse.
 * Lanza AppError con ANALYSIS_TIMEOUT si el proceso es matado por timeout.
 */
function runTsPrune(tsPruneBin: string, tmpDir: string, timeoutMs: number): Finding[] {
  try {
    const result = execSync(`node "${tsPruneBin}"`, {
      cwd: tmpDir,
      timeout: timeoutMs,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });
    return parseTsPruneOutput(result);
  } catch (error: unknown) {
    const execError = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      status?: number | null;
      signal?: string | null;
      killed?: boolean;
    };

    const stdout = execError.stdout
      ? typeof execError.stdout === "string"
        ? execError.stdout
        : execError.stdout.toString("utf-8")
      : "";

    const stderr = execError.stderr
      ? typeof execError.stderr === "string"
        ? execError.stderr
        : execError.stderr.toString("utf-8")
      : "";

    // ts-prune may exit non-zero when it finds issues — parse stdout if available
    if (stdout && stdout.trim().length > 0) {
      return parseTsPruneOutput(stdout);
    }

    // If killed by signal or timeout, map to ANALYSIS_TIMEOUT (504)
    if (execError.signal || execError.killed) {
      throw new AppError(
        ErrorType.ANALYSIS_TIMEOUT,
        `Tiempo de análisis excedido para este repositorio (ts-prune killed by signal: ${execError.signal ?? "SIGTERM"})`,
        error instanceof Error ? error : undefined
      );
    }

    throw new Error(
      `ts-prune failed with exit code ${execError.status}: ${stderr.substring(0, 500)}`
    );
  }
}

/**
 * Analiza código muerto con presupuesto de tiempo compartido.
 * - knip: hasta 120s
 * - ts-prune (fallback): tiempo restante del presupuesto (máx ~60s)
 * - Si ambos agotan el presupuesto total → ANALYSIS_ENGINE_FAILED
 */
export async function analyzeDeadCode(tmpDir: string): Promise<AnalysisResult> {
  const budgetStart = Date.now();

  // Intentar con knip primero (120s max)
  const knipBin = resolveKnipBin();
  if (knipBin) {
    try {
      const findings = runKnip(knipBin, tmpDir, KNIP_TIMEOUT_MS);
      return { findings, engineUsed: "knip" };
    } catch (knipError) {
      if (knipError instanceof AppError && knipError.type === ErrorType.ANALYSIS_TIMEOUT) {
        // knip agotó su timeout — verificar si queda presupuesto para fallback
        const elapsed = Date.now() - budgetStart;
        const remaining = ANALYSIS_BUDGET_MS - elapsed;
        if (remaining <= 5_000) {
          // Menos de 5s restantes — no tiene sentido intentar fallback
          throw new AppError(
            ErrorType.ANALYSIS_ENGINE_FAILED,
            "Presupuesto de análisis agotado tras timeout de knip, sin margen para fallback"
          );
        }
        // Intentar fallback con el tiempo restante
        console.warn(`knip timeout after ${elapsed}ms, attempting ts-prune with ${remaining}ms remaining`);
      } else {
        // knip falló por otra razón — intentar fallback con tiempo restante
        console.error(
          "knip failed, attempting ts-prune fallback:",
          knipError instanceof Error ? knipError.message : String(knipError)
        );
      }
    }
  } else {
    console.error("knip binary not found, attempting ts-prune fallback");
  }

  // Fallback: ts-prune con tiempo restante del presupuesto
  const elapsed = Date.now() - budgetStart;
  const remainingBudget = Math.max(0, ANALYSIS_BUDGET_MS - elapsed);

  if (remainingBudget <= 5_000) {
    throw new AppError(
      ErrorType.ANALYSIS_ENGINE_FAILED,
      `Presupuesto de análisis agotado (${elapsed}ms consumidos), sin margen para ts-prune`
    );
  }

  const tsPruneBin = resolveTsPruneBin();
  if (tsPruneBin) {
    try {
      const findings = runTsPrune(tsPruneBin, tmpDir, remainingBudget);
      return { findings, engineUsed: "ts-prune" };
    } catch (tsPruneError) {
      if (tsPruneError instanceof AppError && tsPruneError.type === ErrorType.ANALYSIS_TIMEOUT) {
        throw new AppError(
          ErrorType.ANALYSIS_ENGINE_FAILED,
          "Presupuesto de análisis agotado: knip + ts-prune excedieron 180s combinados"
        );
      }
      throw new AppError(
        ErrorType.ANALYSIS_ENGINE_FAILED,
        `Both engines failed. ts-prune: ${tsPruneError instanceof Error ? tsPruneError.message : String(tsPruneError)}`,
        tsPruneError instanceof Error ? tsPruneError : undefined
      );
    }
  }

  // Ambos motores no disponibles
  throw new AppError(
    ErrorType.ANALYSIS_ENGINE_FAILED,
    "No analysis engine available: neither knip nor ts-prune binaries could be resolved"
  );
}
