/**
 * Módulo de enriquecimiento de hallazgos con IA (Bedrock).
 *
 * Selecciona un subconjunto de hallazgos para enviar al modelo de lenguaje,
 * enriquece con puntuación de confianza, explicación de riesgo y agrupación,
 * y genera una descripción de PR consolidada.
 */

import { readFile } from "fs/promises";
import * as path from "path";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { Finding, EnrichedFinding, PrDescription } from "./types";

/** Número máximo de hallazgos que se enviarán a Bedrock para enriquecimiento. */
export const MAX_ENRICHMENT_FINDINGS = 50;

/**
 * Selecciona los primeros 50 hallazgos ordenados alfabéticamente por `file`
 * para enriquecimiento. Los restantes se retornan en `remaining`.
 *
 * @param findings - Lista completa de hallazgos del análisis.
 * @returns Un objeto con `selected` (hasta 50 hallazgos) y `remaining` (el resto).
 */
export function selectFindingsForEnrichment(findings: Finding[]): {
  selected: Finding[];
  remaining: Finding[];
} {
  const sorted = [...findings].sort((a, b) => a.file.localeCompare(b.file));
  const selected = sorted.slice(0, MAX_ENRICHMENT_FINDINGS);
  const remaining = sorted.slice(MAX_ENRICHMENT_FINDINGS);

  return { selected, remaining };
}

/** Hallazgo con su contexto de archivo asociado para envío a Bedrock. */
export interface FindingWithContext {
  finding: Finding;
  index: number;
  fileContent: string;
}

/** Límite máximo de caracteres acumulados de contexto de archivo. */
export const MAX_CONTEXT_CHARS = 100_000;

/**
 * Construye los mensajes de sistema y usuario para enviar a Bedrock.
 *
 * @param findingsWithContext - Hallazgos con su contexto de archivo asociado.
 * @returns Objeto con los prompts `system` y `user` listos para envío.
 */
export function buildPromptMessages(findingsWithContext: FindingWithContext[]): {
  system: string;
  user: string;
} {
  const system = `You are a code analysis assistant. Analyze the following dead code findings from a JavaScript/TypeScript repository.

For each finding, provide:
1. confidenceScore: "high", "medium", or "low" — how certain you are this is truly dead code
2. riskExplanation: 1-2 sentences explaining why this is a removal candidate and what risk exists
3. groupId: an 8-character alphanumeric ID shared between related findings (e.g., multiple unused exports from the same file, or an unused file whose exports also appear as findings). Use null if the finding is independent.

Confidence criteria:
- "high": File with no incoming imports and no consumed exports; clearly orphaned code
- "medium": Export that might have dynamic consumers, test-only usage, or conditional imports
- "low": Ambiguous cases — re-exports, plugin patterns, dynamic require/import patterns

Also generate a prDescription object with:
- title: A concise PR title (max 72 characters) summarizing the cleanup
- body: A Markdown-formatted PR body grouping suggested removals by type and file

RESPOND ONLY WITH VALID JSON matching this exact schema:
{
  "findings": [
    { "index": <number>, "confidenceScore": "<high|medium|low>", "riskExplanation": "<string>", "groupId": "<string|null>" }
  ],
  "prDescription": { "title": "<string>", "body": "<string>" }
}

The "index" field must correspond to the 0-based index in the findings array provided in the user message.`;

  let user = `Analyze these ${findingsWithContext.length} dead code findings:\n\n`;

  for (const item of findingsWithContext) {
    const context = item.fileContent || "(no context available)";
    user += `Finding ${item.index}:\n`;
    user += `  File: ${item.finding.file}\n`;
    user += `  Line: ${item.finding.line ?? "null"}\n`;
    user += `  Type: ${item.finding.type}\n`;
    user += `  Name: ${item.finding.name}\n`;
    user += `  Context:\n`;
    user += `  \`\`\`\n  ${context}\n  \`\`\`\n\n`;
  }

  return { system, user };
}

/**
 * Lee el contexto de archivo para cada hallazgo seleccionado.
 * Extrae ±15 líneas alrededor de la línea señalada (o primeras 30 líneas si line=null).
 * Respeta el límite total de 100K caracteres, truncando archivos según sea necesario.
 *
 * @param findings - Hallazgos seleccionados (ya ordenados).
 * @param tmpDir - Directorio temporal donde se descargó el repositorio.
 * @returns Array de FindingWithContext con el contenido relevante de cada archivo.
 */
export async function buildFileContext(
  findings: Finding[],
  tmpDir: string
): Promise<FindingWithContext[]> {
  const results: FindingWithContext[] = [];
  let accumulatedChars = 0;

  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i];
    const filePath = path.join(tmpDir, finding.file);
    let fileContent = "";

    try {
      const rawContent = await readFile(filePath, "utf-8");
      const lines = rawContent.split("\n");

      let extractedLines: string[];
      if (finding.line !== null) {
        // Extract ±15 lines around the flagged line (1-based to 0-based index)
        const startLine = Math.max(0, finding.line - 1 - 15);
        const endLine = Math.min(lines.length, finding.line - 1 + 15 + 1);
        extractedLines = lines.slice(startLine, endLine);
      } else {
        // Entire file flagged: read first 30 lines
        extractedLines = lines.slice(0, 30);
      }

      fileContent = extractedLines.join("\n");
    } catch (err) {
      console.debug(
        `Failed to read file for finding "${finding.name}" at ${filePath}:`,
        err
      );
      // fileContent remains empty string
    }

    // Enforce MAX_CONTEXT_CHARS limit
    if (accumulatedChars >= MAX_CONTEXT_CHARS) {
      fileContent = "";
    } else if (accumulatedChars + fileContent.length > MAX_CONTEXT_CHARS) {
      const remaining = MAX_CONTEXT_CHARS - accumulatedChars;
      fileContent = fileContent.slice(0, remaining);
    }

    accumulatedChars += fileContent.length;

    results.push({
      finding,
      index: i,
      fileContent,
    });
  }

  return results;
}

/** Timeout independiente para la invocación a Bedrock (60 segundos). */
export const BEDROCK_TIMEOUT_MS = 60_000;

/**
 * Invoca el modelo de Bedrock con un timeout independiente.
 * Lanza AbortError si se excede el tiempo límite.
 *
 * @param system - Prompt de sistema para el modelo.
 * @param user - Prompt de usuario con los hallazgos a analizar.
 * @returns El texto de respuesta del modelo.
 */
export async function invokeBedrockWithTimeout(system: string, user: string): Promise<string> {
  const client = new BedrockRuntimeClient({});
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BEDROCK_TIMEOUT_MS);

  const profileId = process.env.BEDROCK_INFERENCE_PROFILE_ID || "us.anthropic.claude-sonnet-4-6";

  try {
    const command = new InvokeModelCommand({
      modelId: profileId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 4096,
        system: system,
        messages: [{ role: "user", content: user }],
      }),
    });

    const response = await client.send(command, {
      abortSignal: controller.signal,
    });

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    return responseBody.content[0].text;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Strips Markdown code fence delimiters (```json ... ``` or ``` ... ```)
 * from around a string. Returns the inner content if fenced, or the
 * trimmed original string if no fences are detected.
 */
export function stripMarkdownCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

/**
 * Parsea y valida la respuesta JSON de Bedrock contra el esquema esperado.
 * Lanza error si la respuesta no es JSON válido o no cumple el esquema.
 *
 * @param raw - Texto crudo de respuesta de Bedrock.
 * @param selectedFindings - Findings originales que se enviaron al modelo.
 * @returns Objeto con enrichedFindings y prDescription validados.
 * @throws Error si el JSON es inválido o el esquema no se cumple.
 */
export function parseBedrockResponse(
  raw: string,
  selectedFindings: Finding[]
): { enrichedFindings: EnrichedFinding[]; prDescription: PrDescription } {
  // 0. Strip Markdown code fence delimiters if present (e.g. ```json ... ```)
  const jsonStr = stripMarkdownCodeFence(raw);

  // 1. Parse raw as JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      `Bedrock response is not valid JSON. First 500 chars: ${raw.slice(0, 500)}`
    );
  }

  // 2. Validate top-level structure
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Bedrock response is not a valid object");
  }

  const response = parsed as Record<string, unknown>;

  // Validate findings array
  if (!Array.isArray(response.findings)) {
    throw new Error("Bedrock response missing 'findings' array");
  }

  // Validate prDescription
  if (
    typeof response.prDescription !== "object" ||
    response.prDescription === null
  ) {
    throw new Error("Bedrock response missing 'prDescription' object");
  }

  const prDesc = response.prDescription as Record<string, unknown>;

  if (typeof prDesc.title !== "string" || prDesc.title.length === 0) {
    throw new Error("prDescription.title must be a non-empty string");
  }
  if (prDesc.title.length > 72) {
    throw new Error(
      `prDescription.title exceeds 72 characters (got ${prDesc.title.length})`
    );
  }
  if (typeof prDesc.body !== "string" || prDesc.body.length === 0) {
    throw new Error("prDescription.body must be a non-empty string");
  }

  const prDescription: PrDescription = {
    title: prDesc.title,
    body: prDesc.body,
  };

  // Validate each finding item
  const groupIdRegex = /^[a-zA-Z0-9]{8}$/;
  const validConfidenceScores = ["high", "medium", "low"] as const;

  // Build a map of index → enrichment data from the response
  const enrichmentMap = new Map<
    number,
    { confidenceScore: "high" | "medium" | "low"; riskExplanation: string; groupId: string | null }
  >();

  for (let i = 0; i < response.findings.length; i++) {
    const item = response.findings[i] as Record<string, unknown>;

    if (typeof item !== "object" || item === null) {
      throw new Error(`findings[${i}] is not a valid object`);
    }

    // Validate index
    if (typeof item.index !== "number" || !Number.isInteger(item.index)) {
      throw new Error(`findings[${i}].index must be an integer`);
    }
    if (item.index < 0 || item.index >= selectedFindings.length) {
      throw new Error(
        `findings[${i}].index (${item.index}) is out of range [0, ${selectedFindings.length - 1}]`
      );
    }

    // Validate confidenceScore
    if (
      typeof item.confidenceScore !== "string" ||
      !validConfidenceScores.includes(item.confidenceScore as "high" | "medium" | "low")
    ) {
      throw new Error(
        `findings[${i}].confidenceScore must be "high", "medium", or "low" (got "${item.confidenceScore}")`
      );
    }

    // Validate riskExplanation
    if (typeof item.riskExplanation !== "string" || item.riskExplanation.length === 0) {
      throw new Error(
        `findings[${i}].riskExplanation must be a non-empty string`
      );
    }

    // Validate groupId
    if (item.groupId !== null) {
      if (typeof item.groupId !== "string" || !groupIdRegex.test(item.groupId)) {
        throw new Error(
          `findings[${i}].groupId must be null or an 8-character alphanumeric string (got "${item.groupId}")`
        );
      }
    }

    enrichmentMap.set(item.index, {
      confidenceScore: item.confidenceScore as "high" | "medium" | "low",
      riskExplanation: item.riskExplanation as string,
      groupId: (item.groupId as string | null),
    });
  }

  // 4. Map parsed findings to EnrichedFinding[] — fill missing indices with null fields
  const enrichedFindings: EnrichedFinding[] = selectedFindings.map((finding, idx) => {
    const enrichment = enrichmentMap.get(idx);
    if (enrichment) {
      return {
        ...finding,
        confidenceScore: enrichment.confidenceScore,
        riskExplanation: enrichment.riskExplanation,
        groupId: enrichment.groupId,
      };
    }
    // Missing index: fill with null fields
    return {
      ...finding,
      confidenceScore: null,
      riskExplanation: null,
      groupId: null,
    };
  });

  // 5. Return result
  return { enrichedFindings, prDescription };
}


/** Resultado del proceso de enriquecimiento de hallazgos. */
export interface EnrichmentResult {
  findings: EnrichedFinding[];
  prDescription: PrDescription | null;
  enriched: boolean;
}

/**
 * Aplica el fallback cuando Bedrock falla: retorna hallazgos con campos null
 * y enriched: false. NUNCA falla el pipeline por un error de Bedrock.
 *
 * @param findings - Hallazgos originales sin enriquecer.
 * @returns EnrichmentResult con campos de enriquecimiento en null.
 */
export function applyFallback(findings: Finding[]): EnrichmentResult {
  return {
    findings: findings.map(f => ({
      ...f,
      confidenceScore: null,
      riskExplanation: null,
      groupId: null,
    })),
    prDescription: null,
    enriched: false,
  };
}

/** Input para la función principal de enriquecimiento. */
export interface EnrichmentInput {
  findings: Finding[];
  tmpDir: string;
}

/**
 * Función principal de enriquecimiento: orquesta la selección de hallazgos,
 * lectura de contexto, construcción de prompts, invocación de Bedrock,
 * y parseo de la respuesta. En caso de cualquier error, aplica fallback.
 *
 * @param input - Objeto con findings y tmpDir.
 * @returns EnrichmentResult con hallazgos enriquecidos (o fallback).
 */
export async function enrichFindings(input: EnrichmentInput): Promise<EnrichmentResult> {
  const { findings, tmpDir } = input;

  // Empty findings → no enrichment needed
  if (findings.length === 0) {
    return { findings: [], prDescription: null, enriched: false };
  }

  try {
    // 1. Select max 50 findings sorted by file
    const { selected, remaining } = selectFindingsForEnrichment(findings);

    // 2. Read file context (respecting 100K char limit)
    const findingsWithContext = await buildFileContext(selected, tmpDir);

    // 3. Build prompt messages
    const { system, user } = buildPromptMessages(findingsWithContext);

    // 4. Invoke Bedrock with 60s timeout
    const rawResponse = await invokeBedrockWithTimeout(system, user);

    // 5. Parse and validate response
    const parsed = parseBedrockResponse(rawResponse, selected);

    // 6. Combine enriched + remaining (remaining with null fields)
    const enrichedFindings: EnrichedFinding[] = [
      ...parsed.enrichedFindings,
      ...remaining.map((f): EnrichedFinding => ({
        ...f,
        confidenceScore: null,
        riskExplanation: null,
        groupId: null,
      })),
    ];

    return {
      findings: enrichedFindings,
      prDescription: parsed.prDescription,
      enriched: true, // At least some findings were enriched
    };
  } catch (error) {
    // Log warning and apply fallback — NEVER fail the pipeline due to Bedrock
    console.warn(JSON.stringify({
      level: "WARNING",
      component: "enricher",
      message: "Bedrock enrichment failed, applying fallback",
      error: error instanceof Error ? error.message : String(error),
    }));

    return applyFallback(findings);
  }
}
