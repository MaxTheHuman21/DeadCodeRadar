/**
 * Sistema de errores tipados para DeadCode Radar.
 * Define un enum de errores de dominio con mapeo 1:1 a códigos HTTP.
 */

/** Tipos de error del dominio, cada uno mapeado a un código HTTP específico. */
export enum ErrorType {
  INVALID_INPUT = "INVALID_INPUT",
  INVALID_JSON = "INVALID_JSON",
  REPO_PRIVATE = "REPO_PRIVATE",
  REPO_NOT_FOUND = "REPO_NOT_FOUND",
  METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED",
  NO_JS_TS_FILES = "NO_JS_TS_FILES",
  NO_PACKAGE_JSON = "NO_PACKAGE_JSON",
  FILES_LIMIT_EXCEEDED = "FILES_LIMIT_EXCEEDED",
  AUTH_FAILED = "AUTH_FAILED",
  GITHUB_UNAVAILABLE = "GITHUB_UNAVAILABLE",
  ANALYSIS_TIMEOUT = "ANALYSIS_TIMEOUT",
  ANALYSIS_ENGINE_FAILED = "ANALYSIS_ENGINE_FAILED",
  DYNAMO_WRITE_FAILED = "DYNAMO_WRITE_FAILED",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

/** Mapeo determinista de tipo de error a código HTTP. */
export const ERROR_HTTP_MAP: Record<ErrorType, number> = {
  [ErrorType.INVALID_INPUT]: 400,
  [ErrorType.INVALID_JSON]: 400,
  [ErrorType.REPO_PRIVATE]: 403,
  [ErrorType.REPO_NOT_FOUND]: 404,
  [ErrorType.METHOD_NOT_ALLOWED]: 405,
  [ErrorType.NO_JS_TS_FILES]: 422,
  [ErrorType.NO_PACKAGE_JSON]: 422,
  [ErrorType.FILES_LIMIT_EXCEEDED]: 422,
  [ErrorType.AUTH_FAILED]: 401,
  [ErrorType.GITHUB_UNAVAILABLE]: 503,
  [ErrorType.ANALYSIS_TIMEOUT]: 504,
  [ErrorType.ANALYSIS_ENGINE_FAILED]: 500,
  [ErrorType.DYNAMO_WRITE_FAILED]: 500,
  [ErrorType.INTERNAL_ERROR]: 500,
};

/** Error de aplicación tipado que extiende Error con un campo `type`. */
export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly cause?: Error;

  constructor(type: ErrorType, message: string, cause?: Error) {
    super(message);
    this.type = type;
    this.cause = cause;
    this.name = "AppError";

    // Mantener stack trace correcto en V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}
