/**
 * Interfaces y tipos compartidos para DeadCode Radar.
 * Utilizados por todos los módulos del pipeline: handler, downloader, analyzer, persistence.
 */

/** Representa un hallazgo de código muerto en el repositorio analizado. */
export interface Finding {
  file: string;           // Ruta relativa al repo
  line: number | null;    // Número de línea (null si no disponible)
  type: "unused-export" | "unused-file" | "unused-dependency";
  name: string;           // Identificador del símbolo muerto
}

/** Hallazgo enriquecido con metadatos de IA (confianza, riesgo, agrupación). */
export interface EnrichedFinding extends Finding {
  confidenceScore: "high" | "medium" | "low" | null;
  riskExplanation: string | null;
  groupId: string | null;
}

/** Descripción de PR generada por el Motor_IA. */
export interface PrDescription {
  title: string;   // Máximo 72 caracteres
  body: string;    // Formato Markdown
}

/** Resultado del motor de análisis con los hallazgos y el motor utilizado. */
export interface AnalysisResult {
  findings: Finding[];
  engineUsed: "knip" | "ts-prune";
}

/** Registro persistido en DynamoDB para cada análisis ejecutado. */
export interface JobRecord {
  jobId: string;          // UUID v4
  repoUrl: string;
  status: "completed" | "error";
  findings: EnrichedFinding[];
  createdAt: string;      // ISO 8601
  filesAnalyzed: number;
  errorMessage?: string;
  truncated?: boolean;
  // Día 2: Campos de enriquecimiento
  enriched?: boolean;
  prDescription?: PrDescription | null;
}

/** Resultado de la descarga de archivos del repositorio. */
export interface DownloadResult {
  tmpDir: string;         // Path al directorio temporal con archivos
  filesDownloaded: number; // Cantidad de archivos descargados
}

/** Configuración para el módulo de descarga de repositorios. */
export interface DownloaderConfig {
  githubToken: string;
  maxFiles: number;        // 500
  timeoutMs: number;       // 30000
  allowedExtensions: string[]; // ['.js', '.ts', '.jsx', '.tsx']
  excludedDirs: string[];  // ['node_modules', 'dist', 'build', '.git']
  configFiles: string[];   // ['tsconfig.json', 'knip.json', 'knip.config.ts', 'knip.config.js']
}

/** Evento recibido por la Lambda Function URL. */
export interface LambdaEvent {
  requestContext: { http: { method: string } };
  body?: string;
  queryStringParameters?: Record<string, string>;
}

/** Respuesta estándar de la Lambda Function. */
export interface LambdaResponse {
  statusCode: number;
  headers: { "Content-Type": "application/json" };
  body: string;
}
