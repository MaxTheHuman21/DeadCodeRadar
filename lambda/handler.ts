/**
 * Handler principal de DeadCode Radar.
 * Punto de entrada de la Lambda Function URL.
 * Rutea por método HTTP: POST → análisis, GET → consulta, otro → 405.
 */

import { rm } from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { LambdaEvent, LambdaResponse, DownloaderConfig, JobRecord } from "./types";
import { AppError, ErrorType, ERROR_HTTP_MAP } from "./errors";
import { validateRepoUrl, validateJobId, isValidJson } from "./validators";
import { downloadRepo } from "./downloader";
import { analyzeDeadCode } from "./analyzer";
import { enrichFindings } from "./enricher";
import { saveResult, getResult } from "./persistence";

/**
 * Crea una respuesta HTTP estándar con Content-Type: application/json.
 */
function buildResponse(statusCode: number, body: object): LambdaResponse {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * Maneja solicitudes POST: valida input, genera jobId, ejecuta pipeline de análisis.
 * Retorna tanto la respuesta como el jobId generado para logging en el handler externo.
 */
async function handlePost(event: LambdaEvent): Promise<{ response: LambdaResponse; jobId: string }> {
  // Validar que el body sea JSON válido
  if (!event.body || !isValidJson(event.body)) {
    throw new AppError(
      ErrorType.INVALID_JSON,
      "El body debe ser JSON válido"
    );
  }

  const parsed = JSON.parse(event.body);
  const { repoUrl } = parsed;

  // Validar repoUrl
  if (!repoUrl) {
    throw new AppError(
      ErrorType.INVALID_INPUT,
      "El campo 'repoUrl' es requerido"
    );
  }

  const validation = validateRepoUrl(repoUrl);
  if (!validation.valid) {
    throw new AppError(
      ErrorType.INVALID_INPUT,
      validation.error || "URL de repositorio inválida"
    );
  }

  // Generar jobId único
  const jobId = uuidv4();

  // Verificar presencia de GITHUB_TOKEN antes de iniciar el pipeline
  if (!process.env.GITHUB_TOKEN) {
    throw new AppError(
      ErrorType.AUTH_FAILED,
      "La autenticación con GitHub falló: GITHUB_TOKEN no está configurado"
    );
  }

  // Configuración del descargador desde variables de entorno
  const config: DownloaderConfig = {
    githubToken: process.env.GITHUB_TOKEN,
    maxFiles: 500,
    timeoutMs: 30000,
    allowedExtensions: ['.js', '.ts', '.jsx', '.tsx'],
    excludedDirs: ['node_modules', 'dist', 'build', '.git'],
    configFiles: ['tsconfig.json', 'knip.json', 'knip.config.ts', 'knip.config.js'],
  };

  try {
    // Paso 1: Descargar repositorio
    const downloadResult = await downloadRepo(
      validation.owner!,
      validation.repo!,
      jobId,
      config
    );

    try {
      // Paso 2: Analizar código muerto
      const analysisResult = await analyzeDeadCode(downloadResult.tmpDir);

      // Paso 3 (NUEVO): Enriquecer hallazgos con Bedrock
      const enrichmentResult = await enrichFindings({
        findings: analysisResult.findings,
        tmpDir: downloadResult.tmpDir,
      });

      // Paso 4: Construir y persistir registro
      const record: JobRecord = {
        jobId,
        repoUrl,
        status: "completed",
        findings: enrichmentResult.findings,
        createdAt: new Date().toISOString(),
        filesAnalyzed: downloadResult.filesDownloaded,
        enriched: enrichmentResult.enriched,
        prDescription: enrichmentResult.prDescription,
      };

      await saveResult(record);

      // Paso 5: Retornar respuesta
      return {
        response: buildResponse(200, {
          jobId,
          status: "completed",
          repoUrl,
          filesAnalyzed: downloadResult.filesDownloaded,
          enriched: enrichmentResult.enriched,
          findings: enrichmentResult.findings,
          prDescription: enrichmentResult.prDescription,
        }),
        jobId,
      };
    } finally {
      // Cleanup /tmp DESPUÉS de enrichment
      await rm(`/tmp/${jobId}`, { recursive: true, force: true }).catch(() => {});
    }
  } catch (error: unknown) {
    // Si es AppError, intentar persistir registro de error (best-effort)
    if (error instanceof AppError) {
      try {
        const errorRecord: JobRecord = {
          jobId,
          repoUrl,
          status: "error",
          findings: [],
          createdAt: new Date().toISOString(),
          filesAnalyzed: 0,
          errorMessage: error.message,
        };
        await saveResult(errorRecord);
      } catch {
        // Best-effort: no lanzar si la persistencia del error falla
      }
    }
    // Attach jobId to error for outer handler to use in logging/response
    (error as any).__jobId = jobId;
    throw error;
  }
}

/**
 * Maneja solicitudes GET: consulta resultado por jobId.
 */
async function handleGet(event: LambdaEvent): Promise<LambdaResponse> {
  const jobId = event.queryStringParameters?.jobId;

  // Validar presencia y formato UUID v4
  if (!jobId || !validateJobId(jobId)) {
    throw new AppError(
      ErrorType.INVALID_INPUT,
      "El jobId es requerido y debe ser un UUID v4 válido"
    );
  }

  try {
    const result = await getResult(jobId);

    if (!result) {
      return buildResponse(404, {
        error: "Resultado no encontrado para el jobId proporcionado",
      });
    }

    return buildResponse(200, {
      jobId: result.jobId,
      repoUrl: result.repoUrl,
      status: result.status,
      findings: result.findings,
      createdAt: result.createdAt,
      filesAnalyzed: result.filesAnalyzed,
      ...(result.enriched !== undefined && { enriched: result.enriched }),
      ...(result.prDescription !== undefined && { prDescription: result.prDescription }),
    });
  } catch (error: unknown) {
    // Si es AppError, re-lanzar para que el handler principal lo maneje
    if (error instanceof AppError) {
      throw error;
    }
    // Error de DynamoDB u otro error inesperado → 500
    return buildResponse(500, {
      error: "Error interno del servidor",
    });
  }
}

/**
 * Handler principal de la Lambda. Rutea por método HTTP.
 * Captura errores globalmente y los mapea a respuestas HTTP JSON.
 */
export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  try {
    const method = event.requestContext?.http?.method?.toUpperCase();

    switch (method) {
      case "POST": {
        const result = await handlePost(event);
        return result.response;
      }

      case "GET":
        return await handleGet(event);

      default:
        throw new AppError(
          ErrorType.METHOD_NOT_ALLOWED,
          "Método no permitido"
        );
    }
  } catch (error: unknown) {
    // Extract jobId attached by handlePost (if available)
    const jobId: string | undefined = (error as any)?.__jobId;

    // Mapear AppError a respuesta HTTP
    if (error instanceof AppError) {
      const statusCode = ERROR_HTTP_MAP[error.type];

      // Registrar en CloudWatch con jobId, mensaje y stack trace
      console.error(JSON.stringify({
        level: "ERROR",
        jobId: jobId ?? "unknown",
        errorType: error.type,
        message: error.message,
        stack: error.stack,
      }));

      return buildResponse(statusCode, {
        error: error.message,
        ...(jobId && { jobId }),
      });
    }

    // Error no tipado (inesperado) → INTERNAL_ERROR (500)
    const unexpectedError = error instanceof Error ? error : new Error(String(error));

    console.error(JSON.stringify({
      level: "ERROR",
      jobId: jobId ?? "unknown",
      errorType: "INTERNAL_ERROR",
      message: unexpectedError.message,
      stack: unexpectedError.stack,
    }));

    return buildResponse(500, {
      error: "Error interno del servidor",
      ...(jobId && { jobId }),
    });
  }
}
