/**
 * Módulo de persistencia para DeadCode Radar.
 * Gestiona la lectura y escritura de registros de análisis en DynamoDB.
 */

import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { JobRecord, Finding, EnrichedFinding, PrDescription } from "./types";
import { AppError, ErrorType } from "./errors";

/** Cliente DynamoDB instanciado una vez para reutilizar conexión entre invocaciones. */
const client = new DynamoDBClient({});

/** Nombre de la tabla DynamoDB, obtenido de la variable de entorno TABLE_NAME. */
const TABLE_NAME = process.env.TABLE_NAME ?? "";

/**
 * Umbral conservador para el tamaño máximo de un item en DynamoDB.
 * DynamoDB tiene un límite absoluto de 400KB (409600 bytes).
 * Usamos 380KB como umbral para dejar margen de seguridad.
 */
const MAX_ITEM_SIZE_BYTES = 380_000;

/**
 * Estima el tamaño serializado de un item DynamoDB.
 * Usa JSON.stringify como aproximación del tamaño en bytes.
 */
export function estimateItemSize(item: Record<string, any>): number {
  return Buffer.byteLength(JSON.stringify(item), "utf-8");
}

/**
 * Trunca el array de findings en un JobRecord si el item serializado excede el límite de DynamoDB.
 * Usa búsqueda binaria para encontrar el número máximo de findings que caben.
 * Muta el record directamente: ajusta findings y establece truncated=true si se truncó.
 */
export function truncateIfNeeded(record: JobRecord): void {
  // Construir item de prueba para estimar tamaño
  const buildItem = (rec: JobRecord): Record<string, any> => {
    const item: Record<string, any> = {
      jobId: { S: rec.jobId },
      repoUrl: { S: rec.repoUrl },
      status: { S: rec.status },
      findings: { S: JSON.stringify(rec.findings) },
      createdAt: { S: rec.createdAt },
      filesAnalyzed: { N: String(rec.filesAnalyzed) },
    };
    if (rec.errorMessage !== undefined) {
      item.errorMessage = { S: rec.errorMessage };
    }
    if (rec.truncated !== undefined) {
      item.truncated = { BOOL: rec.truncated };
    }
    if (rec.enriched !== undefined) {
      item.enriched = { BOOL: rec.enriched };
    }
    if (rec.prDescription) {
      item.prDescription = { S: JSON.stringify(rec.prDescription) };
    }
    return item;
  };

  const initialItem = buildItem(record);
  if (estimateItemSize(initialItem) <= MAX_ITEM_SIZE_BYTES) {
    return; // No se necesita truncamiento
  }

  // Marcar como truncado
  record.truncated = true;

  // Búsqueda binaria para encontrar el máximo de findings que caben
  let low = 0;
  let high = record.findings.length;
  let bestFit = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const testRecord: JobRecord = {
      ...record,
      findings: record.findings.slice(0, mid),
      truncated: true,
    };
    const testItem = buildItem(testRecord);

    if (estimateItemSize(testItem) <= MAX_ITEM_SIZE_BYTES) {
      bestFit = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  record.findings = record.findings.slice(0, bestFit);
}

/**
 * Persiste un registro de análisis en DynamoDB.
 * Serializa findings como JSON string y construye los AttributeValues manualmente.
 * Si PutItem falla, loguea a CloudWatch y lanza AppError con DYNAMO_WRITE_FAILED.
 */
export async function saveResult(record: JobRecord): Promise<void> {
  // Truncar findings si el item excede el límite de DynamoDB (400KB)
  truncateIfNeeded(record);

  const item: Record<string, any> = {
    jobId: { S: record.jobId },
    repoUrl: { S: record.repoUrl },
    status: { S: record.status },
    findings: { S: JSON.stringify(record.findings) },
    createdAt: { S: record.createdAt },
    filesAnalyzed: { N: String(record.filesAnalyzed) },
  };

  if (record.errorMessage !== undefined) {
    item.errorMessage = { S: record.errorMessage };
  }

  if (record.truncated !== undefined) {
    item.truncated = { BOOL: record.truncated };
  }

  if (record.enriched !== undefined) {
    item.enriched = { BOOL: record.enriched };
  }

  if (record.prDescription) {
    item.prDescription = { S: JSON.stringify(record.prDescription) };
  }

  try {
    await client.send(
      new PutItemCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[persistence] DynamoDB PutItem failed:", {
      jobId: record.jobId,
      tableName: TABLE_NAME,
      error: err.message,
      stack: err.stack,
    });
    throw new AppError(
      ErrorType.DYNAMO_WRITE_FAILED,
      `Failed to save result for job ${record.jobId}: ${err.message}`,
      err
    );
  }
}

/**
 * Recupera un registro de análisis desde DynamoDB por jobId.
 * Retorna null si el item no existe.
 */
export async function getResult(jobId: string): Promise<JobRecord | null> {
  const response = await client.send(
    new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        jobId: { S: jobId },
      },
    })
  );

  if (!response.Item) {
    return null;
  }

  const item = response.Item;

  const record: JobRecord = {
    jobId: item.jobId?.S ?? "",
    repoUrl: item.repoUrl?.S ?? "",
    status: (item.status?.S as "completed" | "error") ?? "error",
    findings: JSON.parse(item.findings?.S ?? "[]") as EnrichedFinding[],
    createdAt: item.createdAt?.S ?? "",
    filesAnalyzed: Number(item.filesAnalyzed?.N ?? "0"),
  };

  if (item.errorMessage?.S !== undefined) {
    record.errorMessage = item.errorMessage.S;
  }

  if (item.truncated?.BOOL !== undefined) {
    record.truncated = item.truncated.BOOL;
  }

  if (item.enriched?.BOOL !== undefined) {
    record.enriched = item.enriched.BOOL;
  }

  if (item.prDescription?.S) {
    record.prDescription = JSON.parse(item.prDescription.S) as PrDescription;
  }

  return record;
}
