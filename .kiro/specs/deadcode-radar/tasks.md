# Implementation Plan: DeadCode Radar (MVP Día 1)

## Overview

Implementación incremental del pipeline end-to-end: POST → descarga → análisis → persistencia → respuesta. Cada tarea construye sobre la anterior, priorizando P0 (flujo core), P1 (errores + tests unitarios) y finalmente P2 (stretch goals).

## Tasks

- [x] 1. Configurar estructura del proyecto e infraestructura CDK
  - [x] 1.1 Inicializar proyecto CDK y dependencias
    - Crear `package.json` con dependencias: `aws-cdk-lib`, `constructs`, `@aws-sdk/client-dynamodb`, `@octokit/rest`, `uuid`, `knip`, `ts-prune`
    - Crear `tsconfig.json` configurado para Node.js 20 y ES2022
    - Crear `cdk.json` con `app: "npx ts-node --prefer-ts-exts bin/app.ts"`
    - Instalar devDependencies: `vitest`, `typescript`, `ts-node`, `aws-cdk`
    - Nota: `knip` y `ts-prune` son dependencias de producción porque se invocan como subprocesos CLI en Lambda (no como librerías importadas)
    - _Requirements: 6.1_

  - [x] 1.2 Crear stack CDK con Lambda, DynamoDB y Function URL
    - Crear `bin/app.ts` como entry point CDK
    - Crear `lib/deadcode-radar-stack.ts` con:
      - Lambda Function (Node.js 20.x, 1024MB, timeout 5min, ephemeralStorage 512MB)
      - Bundling con `NodejsFunction` usando la opción `bundling.nodeModules: ['knip', 'ts-prune']` para incluir estos paquetes como node_modules reales en el deployment package (necesario porque se invocan como subprocesos CLI, no como imports)
      - Excluir `@aws-sdk/*` del bundle (ya disponible en runtime Lambda)
      - DynamoDB table `deadcode-radar-jobs` (partition key: `jobId` String, on-demand, RemovalPolicy.DESTROY)
      - Function URL (AuthType.NONE, CORS: allowedOrigins `*`, allowedMethods POST/GET)
      - Variable de entorno `GITHUB_TOKEN` y `TABLE_NAME`
      - Permisos read/write de Lambda sobre la tabla DynamoDB
      - CfnOutput `FunctionUrl` con la URL generada
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 2. Implementar tipos compartidos y sistema de errores
  - [x] 2.1 Crear interfaces y tipos compartidos (`lambda/types.ts`)
    - Definir interfaces: `Finding`, `AnalysisResult`, `JobRecord`, `DownloadResult`, `DownloaderConfig`
    - Definir tipos para `LambdaEvent` y `LambdaResponse`
    - _Requirements: 3.2, 3.3, 4.2_

  - [x] 2.2 Crear sistema de errores tipados (`lambda/errors.ts`)
    - Implementar `ErrorType` enum con todos los tipos de error del dominio
    - Implementar `ERROR_HTTP_MAP` con mapeo tipo → código HTTP
    - Implementar clase `AppError` que extienda Error con campo `type: ErrorType`
    - _Requirements: 7.3, 7.4_

- [x] 3. Implementar validadores (`lambda/validators.ts`)
  - [x] 3.1 Implementar funciones de validación
    - `validateRepoUrl(url: string)`: valida formato `https://github.com/{owner}/{repo}`, extrae owner/repo
    - `validateJobId(jobId: string)`: valida formato UUID v4
    - `isValidJson(body: string)`: verifica que el string sea JSON parseable
    - _Requirements: 1.2, 1.4, 1.5, 5.3_

- [x] 4. Implementar handler/router (`lambda/handler.ts`)
  - [x] 4.1 Crear handler principal con ruteo por método HTTP
    - Exportar función `handler(event: LambdaEvent): Promise<LambdaResponse>`
    - Rutear POST → pipeline de análisis, GET → consulta de resultado
    - Retornar 405 para métodos no soportados
    - Todas las respuestas con `Content-Type: application/json`
    - Para POST: parsear body JSON, validar `repoUrl`, generar jobId (uuid v4)
    - Implementar try/catch global que capture `AppError`, mapee a HTTP y retorne JSON
    - Registrar errores en console (CloudWatch) con jobId, mensaje y stack trace
    - _Requirements: 1.1, 1.3, 1.5, 1.6, 7.1, 7.2, 7.4, 7.5, 7.6_

- [x] 5. Implementar módulo de descarga (`lambda/downloader.ts`)
  - [x] 5.1 Crear función `downloadRepo` con lógica de descarga
    - Instanciar Octokit con `GITHUB_TOKEN` desde variables de entorno
    - Obtener tree recursivo con `octokit.rest.git.getTree({ recursive: true })`
    - Filtrar archivos por extensiones permitidas (.js, .ts, .jsx, .tsx) y excluir directorios (node_modules, dist, build, .git)
    - Verificar presencia de `package.json` en raíz → error `NO_PACKAGE_JSON` si no existe
    - Verificar que existan archivos JS/TS → error `NO_JS_TS_FILES` si vacío
    - Verificar que archivos elegibles ≤ 500 → error `FILES_LIMIT_EXCEEDED` si excede
    - Descargar archivos en paralelo (batches de 10) con `octokit.rest.git.getBlob()`
    - Descargar archivos de configuración opcionales (tsconfig.json, knip.json, knip.config.ts, knip.config.js) si existen
    - Escribir archivos a `/tmp/{jobId}/` preservando estructura de directorios
    - Manejar errores de GitHub API: 401 → `AUTH_FAILED`, 403 → `REPO_PRIVATE`, 404 → `REPO_NOT_FOUND`, 429 o timeout → `GITHUB_UNAVAILABLE`
    - Validar que `GITHUB_TOKEN` esté configurado → error `AUTH_FAILED` si ausente
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13_

- [x] 6. Implementar motor de análisis (`lambda/analyzer.ts`)
  - [x] 6.1 Crear función `analyzeDeadCode` con knip y fallback a ts-prune
    - Ubicar el binario de knip usando `require.resolve('knip/bin/knip.js')` (o la ruta del bin declarada en su package.json) para invocarlo directamente sin npx
    - Ejecutar knip como subproceso con `child_process.execSync('node <path-to-knip-bin> --reporter json', { cwd: tmpDir, timeout: 240000 })` — el `cwd` debe apuntar explícitamente al directorio temporal donde se descargaron los archivos del repo
    - Parsear output JSON de knip y transformar a array de `Finding`
    - Mapear tipos de knip a enum: `unused-export`, `unused-file`, `unused-dependency`
    - Si knip falla, ubicar el binario de ts-prune con `require.resolve('ts-prune/lib/index.js')` (o su bin path) e invocar con el mismo patrón de `cwd` explícito apuntando al directorio temporal
    - Si ambos fallan, lanzar `AppError` con tipo `ANALYSIS_ENGINE_FAILED`
    - Retornar `AnalysisResult` con findings y engineUsed
    - Nota: NO usar `npx` — los binarios ya están en el deployment package gracias a `bundling.nodeModules` del CDK stack (Task 1.2)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 7. Implementar módulo de persistencia (`lambda/persistence.ts`)
  - [x] 7.1 Crear funciones `saveResult` y `getResult`
    - Instanciar DynamoDB client con `@aws-sdk/client-dynamodb`
    - `saveResult(record: JobRecord)`: PutItem a la tabla (nombre desde env `TABLE_NAME`)
    - Serializar `findings` como JSON string para el campo de DynamoDB
    - Incluir todos los campos obligatorios: jobId, repoUrl, status, findings, createdAt, filesAnalyzed
    - En caso de error, incluir campo `errorMessage`
    - Si PutItem falla, loguear a CloudWatch y lanzar `AppError` con `DYNAMO_WRITE_FAILED`
    - `getResult(jobId: string)`: GetItem desde la tabla, retornar `JobRecord | null`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 8. Integrar pipeline completo en handler
  - [x] 8.1 Conectar todos los módulos en el flujo POST del handler
    - En handler POST: validar → generar jobId → descargar → analizar → persistir → responder
    - En caso de error durante el pipeline, persistir registro con status "error" y errorMessage
    - Retornar respuesta exitosa: `{ jobId, status: "completed", repoUrl, filesAnalyzed, findings }`
    - Limpiar directorio temporal `/tmp/{jobId}` después del análisis (try/finally)
    - _Requirements: 1.3, 4.3, 7.2_

- [x] 9. Checkpoint — Verificar flujo core POST end-to-end
  - Ensure all tests pass, ask the user if questions arise.
  - Verificar que `cdk synth` genera el template CloudFormation correctamente.

- [x] 10. Implementar manejo de errores completo
  - [x] 10.1 Refinar manejo de errores y logging en todos los módulos
    - Verificar que todos los módulos lanzan `AppError` con tipo correcto
    - Verificar mapeo completo de errores HTTP: 400, 401, 403, 404, 405, 422, 500, 503, 504
    - Asegurar que errores inesperados (no AppError) se capturan como `INTERNAL_ERROR` (500)
    - Validar que todos los errores se loguean con jobId, mensaje y stack trace
    - Verificar que timeout de Lambda (5 min) retorna 504
    - _Requirements: 7.3, 7.4, 7.5, 7.6_

- [x] 11. Tests unitarios (Vitest)
  - [x]* 11.1 Tests del handler (`test/unit/handler.test.ts`)
    - Test ruteo: POST → pipeline, GET → consulta, otros → 405
    - Test parsing body JSON inválido → 400
    - Test validación repoUrl ausente/inválido → 400
    - Test respuesta exitosa con estructura correcta
    - Test Content-Type: application/json en todas las respuestas
    - _Requirements: 1.1, 1.4, 1.5, 1.6, 7.1, 7.6_

  - [x]* 11.2 Tests de validadores (`test/unit/validators.test.ts`)
    - Test `validateRepoUrl`: URLs válidas (github.com/owner/repo), URLs inválidas (otros dominios, sin owner, sin repo, con paths extra)
    - Test `validateJobId`: UUID v4 válidos e inválidos
    - Test `isValidJson`: JSON válido, string vacío, null, malformed
    - _Requirements: 1.2, 1.4, 1.5_

  - [x]* 11.3 Tests del módulo de descarga (`test/unit/downloader.test.ts`)
    - Test filtrado de extensiones: acepta .js/.ts/.jsx/.tsx, rechaza otras
    - Test exclusión de directorios: node_modules, dist, build, .git
    - Test detección de archivos de configuración opcionales
    - Test error cuando no hay package.json
    - Test error cuando no hay archivos JS/TS
    - Test error cuando excede 500 archivos
    - Mock de Octokit para simular respuestas de GitHub API
    - _Requirements: 2.2, 2.4, 2.6, 2.9, 2.10, 2.13_

  - [x]* 11.4 Tests del analyzer (`test/unit/analyzer.test.ts`)
    - Test transformación de output knip → estructura Finding correcta
    - Test que cada finding tiene: file, line, type, name
    - Test fallback a ts-prune cuando knip falla
    - Test error cuando ambos motores fallan
    - _Requirements: 3.2, 3.3, 3.4, 3.5_

- [x] 12. Checkpoint — Verificar tests y build completo
  - Ensure all tests pass, ask the user if questions arise.
  - Ejecutar `npx vitest --run` para confirmar que todos los tests pasan.
  - Ejecutar `cdk synth` para confirmar que el template CDK es válido.

- [x] 13. (Fase 2 / Stretch) Implementar GET por jobId
  - [x] 13.1 Implementar flujo GET en handler para consultar resultados
    - Extraer `jobId` de `queryStringParameters`
    - Validar formato UUID v4 con `validateJobId` → 400 si inválido o ausente
    - Llamar `getResult(jobId)` del módulo de persistencia
    - Si registro existe, retornar 200 con campos: jobId, repoUrl, status, findings, createdAt, filesAnalyzed
    - Si registro no existe, retornar 404 con `{ "error": "Resultado no encontrado para el jobId proporcionado" }`
    - Si DynamoDB falla, retornar 500 con `{ "error": "Error interno del servidor" }`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 14. (Fase 2 / Stretch) Truncamiento de findings >400KB
  - [x] 14.1 Implementar truncamiento en módulo de persistencia
    - Antes de PutItem, calcular tamaño serializado del item
    - Si excede 400KB, truncar array `findings` conservando los primeros hallazgos
    - Añadir campo `truncated: true` al registro
    - Re-calcular tamaño hasta que sea ≤ 400KB
    - _Requirements: 4.5_

- [x] 15. Checkpoint final
  - Ensure all tests pass, ask the user if questions arise.
  - Verificar `cdk synth`, `npx vitest --run` y que todos los componentes están integrados.

---

## Día 2 — Enriquecimiento con Amazon Bedrock (Requirement 8)

- [x] 16. Actualizar tipos compartidos e instalar dependencias
  - [x] 16.1 Actualizar `lambda/types.ts` con interfaces de enriquecimiento
    - Añadir interfaz `EnrichedFinding` que extienda `Finding` con campos: `confidenceScore` ("high" | "medium" | "low" | null), `riskExplanation` (string | null), `groupId` (string | null)
    - Añadir interfaz `PrDescription` con campos: `title` (string, max 72 chars), `body` (string, formato Markdown)
    - Actualizar `JobRecord`: cambiar tipo de `findings` a `EnrichedFinding[]`, añadir campos opcionales `enriched?: boolean` y `prDescription?: PrDescription | null`
    - _Requirements: 8.15, 8.16, 8.18, 8.19_

  - [x] 16.2 Instalar dependencia `@aws-sdk/client-bedrock-runtime` y `fast-check`
    - Añadir `@aws-sdk/client-bedrock-runtime: ^3.712.0` a dependencies en `package.json`
    - Añadir `fast-check: ^3.22.0` a devDependencies en `package.json`
    - Ejecutar `npm install`
    - _Requirements: 8.2_

- [x] 17. Implementar presupuesto de tiempo compartido en analyzer (`lambda/analyzer.ts`)
  - [x] 17.1 Refactorizar `analyzeDeadCode` con presupuesto global de 180s
    - Reemplazar constante `ANALYSIS_TIMEOUT_MS = 240_000` por `ANALYSIS_BUDGET_MS = 180_000` y `KNIP_TIMEOUT_MS = 120_000`
    - Modificar `runKnip` para aceptar parámetro `timeoutMs: number` en lugar de usar la constante global
    - Modificar `runTsPrune` para aceptar parámetro `timeoutMs: number` en lugar de usar la constante global
    - Implementar lógica de presupuesto compartido: knip recibe 120s, ts-prune recibe el tiempo restante (máx ~60s)
    - Si knip falla por timeout, calcular `remainingBudget = ANALYSIS_BUDGET_MS - elapsed` y pasar a ts-prune
    - Si `remainingBudget <= 5_000ms`, lanzar `ANALYSIS_ENGINE_FAILED` sin intentar fallback
    - Ver diseño completo en `design.md` sección "Módulo Modificado: lambda/analyzer.ts"
    - _Requirements: 8.24_

- [x] 18. Crear módulo de enriquecimiento (`lambda/enricher.ts`)
  - [x] 18.1 Implementar función `selectFindingsForEnrichment`
    - Ordenar findings alfabéticamente por campo `file`
    - Seleccionar los primeros 50 findings como `selected`
    - Retornar `{ selected, remaining }` donde remaining son los que no pasan por Bedrock
    - _Requirements: 8.22_

  - [x] 18.2 Implementar función `buildFileContext`
    - Para cada finding seleccionado, leer el archivo desde `tmpDir`
    - Si `line` no es null: extraer ±15 líneas alrededor de la línea señalada
    - Si `line` es null: leer las primeras 30 líneas del archivo
    - Acumular contexto con límite total de 100,000 caracteres
    - Si agregar el contexto del siguiente finding excede 100K: truncar contenido de ese archivo
    - Si ya se alcanzó 100K: incluir finding sin contexto (solo metadatos)
    - Si la lectura de un archivo falla: incluir finding sin contexto y loguear con nivel DEBUG
    - Retornar array de `FindingWithContext` con index, finding y fileContent
    - _Requirements: 8.3, 8.23_

  - [x] 18.3 Implementar función `buildPromptMessages`
    - Construir system prompt con instrucciones de formato JSON, esquema esperado y criterios de confianza (ver diseño)
    - Construir user prompt dinámicamente con formato: "Finding N: File, Line, Type, Name, Context"
    - Retornar `{ system, user }` como strings
    - _Requirements: 8.4_

  - [x] 18.4 Implementar función `invokeBedrockWithTimeout`
    - Instanciar `BedrockRuntimeClient` de `@aws-sdk/client-bedrock-runtime`
    - Crear `AbortController` con timeout de 60 segundos (`setTimeout`)
    - Leer `BEDROCK_INFERENCE_PROFILE_ID` de env (default: `us.anthropic.claude-sonnet-4-6`)
    - Construir `InvokeModelCommand` con `anthropic_version: "bedrock-2023-05-31"`, `max_tokens: 4096`, system y messages
    - Enviar comando con `abortSignal: controller.signal`
    - Parsear respuesta: decodificar body, extraer `content[0].text`
    - Limpiar timeout en bloque `finally`
    - Si falla o timeout: propagar error para que el caller aplique fallback
    - _Requirements: 8.1, 8.2, 8.21_

  - [x] 18.5 Implementar función `parseBedrockResponse`
    - Parsear string como JSON
    - Validar que `findings` sea un array con items conteniendo: `index` (number), `confidenceScore` ("high"|"medium"|"low"), `riskExplanation` (string no vacío), `groupId` (string de 8 chars alfanuméricos o null)
    - Validar que `prDescription` contenga `title` (≤72 chars) y `body` (string no vacío)
    - Mapear findings parseados a `EnrichedFinding[]` combinando con los findings originales seleccionados
    - Si JSON inválido o esquema no cumple: lanzar error
    - _Requirements: 8.5, 8.6, 8.7, 8.9, 8.10_

  - [x] 18.6 Implementar función `applyFallback` y función principal `enrichFindings`
    - `applyFallback`: retorna todos los findings con `confidenceScore: null`, `riskExplanation: null`, `groupId: null`, y `prDescription: null`, `enriched: false`
    - `enrichFindings`: orquesta el flujo completo:
      1. Si findings vacío → retornar `{ findings: [], prDescription: null, enriched: false }`
      2. `selectFindingsForEnrichment` → seleccionar max 50
      3. `buildFileContext` → leer contexto de archivos
      4. `buildPromptMessages` → construir prompt
      5. `invokeBedrockWithTimeout` → invocar Bedrock
      6. `parseBedrockResponse` → parsear y validar
      7. Combinar enriched (selected) + remaining (con campos null)
      8. Retornar `{ findings: enrichedFindings, prDescription, enriched: true }`
    - Envolver todo en try/catch: ante cualquier error, loguear WARNING y aplicar fallback
    - _Requirements: 8.11, 8.12, 8.25_

- [x] 19. Checkpoint — Verificar módulo enricher compilable
  - Ensure all tests pass, ask the user if questions arise.
  - Verificar que `npx tsc --noEmit` pasa sin errores.

- [x] 20. Actualizar handler (`lambda/handler.ts`)
  - [x] 20.1 Reestructurar pipeline POST para incluir enriquecimiento
    - Importar `enrichFindings` desde `./enricher`
    - Reestructurar el bloque try/finally de `handlePost`:
      - Mover cleanup de `/tmp/{jobId}` DESPUÉS del paso de enriquecimiento (no inmediatamente después del análisis)
      - Paso 1: Descargar repositorio
      - Paso 2: Analizar código muerto (dentro del try, con /tmp disponible)
      - Paso 3 (NUEVO): `enrichFindings({ findings: analysisResult.findings, tmpDir: downloadResult.tmpDir })`
      - Paso 4: Construir JobRecord con nuevos campos: `enriched`, `prDescription`, y findings como `EnrichedFinding[]`
      - Paso 5: `saveResult(record)`
      - Paso 6: Retornar respuesta con campos `enriched`, `prDescription` y findings enriquecidos
      - finally: cleanup `/tmp/{jobId}`
    - Actualizar respuesta exitosa de GET para incluir campos `enriched` y `prDescription` si existen
    - _Requirements: 8.18, 8.19, 8.20_

- [x] 21. Actualizar persistencia (`lambda/persistence.ts`)
  - [x] 21.1 Añadir soporte para campos de enriquecimiento en `saveResult` y `getResult`
    - En `saveResult`: añadir campos `enriched` (BOOL) y `prDescription` (S, JSON serializado) al item DynamoDB si están presentes en el record
    - Actualizar `truncateIfNeeded` para incluir los nuevos campos en la estimación de tamaño
    - En `getResult`: leer campo `enriched` (BOOL) e hidratar en el record devuelto
    - En `getResult`: leer campo `prDescription` (S), parsear JSON y asignar al record
    - Mantener compatibilidad retroactiva: registros sin estos campos deben funcionar sin error
    - Nota: los campos de enriquecimiento en findings (confidenceScore, riskExplanation, groupId) se serializan como parte del JSON del campo `findings` existente — no requieren columnas adicionales
    - _Requirements: 8.15, 8.16, 8.17_

- [x] 22. Actualizar stack CDK (`lib/deadcode-radar-stack.ts`)
  - [x] 22.1 Añadir variable de entorno y permisos IAM para Bedrock
    - Añadir variable de entorno `BEDROCK_INFERENCE_PROFILE_ID` (default: `us.anthropic.claude-sonnet-4-6`)
    - Importar `aws-cdk-lib/aws-iam`
    - Añadir `PolicyStatement` con acción `bedrock:InvokeModel` y resources: `arn:aws:bedrock:*::foundation-model/*` y `arn:aws:bedrock:*:${this.account}:inference-profile/*`
    - Añadir la policy al role de la Lambda con `handler.addToRolePolicy(...)`
    - _Requirements: 8.13, 8.14_

- [x] 23. Checkpoint — Verificar pipeline completo Día 2
  - Ensure all tests pass, ask the user if questions arise.
  - Verificar que `cdk synth` genera template con nueva variable de entorno y policy IAM.
  - Verificar que `npx tsc --noEmit` compila sin errores.

- [ ] 24. Tests unitarios del enricher (`test/unit/enricher.test.ts`)
  - [ ]* 24.1 Tests unitarios del módulo enricher
    - Test: Bedrock se invoca exactamente 1 vez (mock de BedrockRuntimeClient)
    - Test: System prompt contiene instrucción JSON y esquema esperado
    - Test: Timeout de 60s activa fallback (mock con AbortController)
    - Test: Respuesta no-JSON activa fallback
    - Test: Respuesta que no cumple esquema activa fallback
    - Test: Selección de máx 50 findings ordenados por file
    - Test: Findings con >50 elementos: primeros 50 enriquecidos, resto con null
    - Test: Env var BEDROCK_INFERENCE_PROFILE_ID leída correctamente
    - Test: Error de red activa fallback
    - Test: Findings vacío retorna `{ findings: [], prDescription: null, enriched: false }`
    - _Requirements: 8.1, 8.4, 8.11, 8.12, 8.21, 8.22, 8.25_

- [ ] 25. Tests unitarios actualizados para handler y persistence
  - [ ]* 25.1 Actualizar `test/unit/handler.test.ts` para pipeline Día 2
    - Test: Pipeline order — enrich se ejecuta ANTES de cleanup de /tmp
    - Test: Respuesta HTTP incluye `enriched: true` cuando enriquecimiento exitoso
    - Test: Respuesta HTTP incluye `enriched: false` cuando fallback activo
    - Test: Respuesta HTTP incluye campo `prDescription` cuando enriquecimiento exitoso
    - _Requirements: 8.18, 8.19, 8.20_

  - [ ]* 25.2 Actualizar `test/unit/persistence.test.ts` para campos de enriquecimiento
    - Test: `saveResult` persiste campos `enriched` y `prDescription`
    - Test: `getResult` recupera campos `enriched` y `prDescription` correctamente
    - Test: Registros legacy (sin campos de enriquecimiento) se recuperan sin error
    - _Requirements: 8.15, 8.16, 8.17_

  - [ ]* 25.3 Actualizar `test/unit/analyzer.test.ts` para presupuesto de tiempo compartido
    - Test: `ANALYSIS_BUDGET_MS` es 180_000 y `KNIP_TIMEOUT_MS` es 120_000
    - Test: knip timeout (120s) activa fallback a ts-prune con tiempo remanente calculado correctamente (remainingBudget = ANALYSIS_BUDGET_MS - elapsed)
    - Test: si `remainingBudget <= 5_000ms` tras timeout de knip, lanza `ANALYSIS_ENGINE_FAILED` sin intentar ts-prune
    - Test: si tanto knip como ts-prune agotan el presupuesto combinado (180s), lanza `ANALYSIS_ENGINE_FAILED`
    - Mock de `execSync` para simular timeouts y medir que `runTsPrune` recibe el timeout correcto (tiempo remanente, no 180s completos)
    - _Requirements: 8.24_

- [ ] 26. Tests de propiedad del enricher (`test/property/enricher.property.test.ts`)
  - [ ]* 26.1 Write property test for file context inclusion
    - **Property 1: Inclusión de contexto de archivo en el prompt**
    - Para cualquier finding seleccionado con archivo existente en tmpDir, el prompt construido DEBE contener un fragmento del contenido de ese archivo
    - Usar generador `findingArb` con `fc.record` y crear archivos temporales reales
    - **Validates: Requirements 8.3**

  - [ ]* 26.2 Write property test for Bedrock response schema validation
    - **Property 2: Validación del esquema de respuesta de Bedrock**
    - Para cualquier respuesta JSON válida, `confidenceScore` es "high"|"medium"|"low", `groupId` es null o string alfanumérico de 8 chars, `riskExplanation` es string no vacío, `prDescription.title` ≤72 chars
    - Generar respuestas arbitrarias con fast-check y validar que `parseBedrockResponse` acepta/rechaza correctamente
    - **Validates: Requirements 8.6, 8.7, 8.9, 8.10**

  - [ ]* 26.3 Write property test for fallback on any Bedrock failure
    - **Property 3: Fallback ante cualquier falla de Bedrock**
    - Para cualquier tipo de fallo (error de red, timeout, no-JSON, esquema inválido) y cualquier conjunto de findings, resultado DEBE contener los mismos findings con campos null y `enriched: false`
    - Mock de `invokeBedrockWithTimeout` con diferentes tipos de errores generados por fast-check
    - **Validates: Requirements 8.11, 8.12, 8.21**

  - [ ]* 26.4 Write property test for 50-finding selection limit
    - **Property 5: Límite de selección de 50 hallazgos**
    - Para cualquier conjunto con >50 findings, seleccionar exactamente los primeros 50 ordenados por `file`, el resto con campos null
    - Generar arrays de 51-200 findings y verificar invariante
    - **Validates: Requirements 8.22**

  - [ ]* 26.5 Write property test for 100K character payload limit
    - **Property 6: Límite de payload de 100K caracteres**
    - Para cualquier conjunto de findings y contextos de archivo, el user prompt DEBE tener longitud ≤ 100,000 caracteres
    - Generar findings con archivos de contexto largo y verificar truncamiento
    - **Validates: Requirements 8.23**

  - [ ]* 26.6 Write property test for enriched field semantics
    - **Property 7: Semántica del campo enriched**
    - `enriched` DEBE ser `true` sii al menos un finding tiene `confidenceScore` no-null; `false` exclusivamente cuando la llamada falló completamente
    - Generar resultados mixtos (parcialmente enriquecidos) y verificar coherencia del flag
    - **Validates: Requirements 8.25**

- [ ] 27. Tests de propiedad de persistencia (`test/property/persistence.property.test.ts`)
  - [ ]* 27.1 Write property test for enriched findings round-trip persistence
    - **Property 4: Persistencia round-trip de hallazgos enriquecidos**
    - Para cualquier JobRecord con campos de enriquecimiento, al persistir y recuperar, todos los campos DEBEN preservarse idénticos
    - Para cualquier JobRecord legacy (sin campos de enriquecimiento), la recuperación DEBE completarse sin error
    - Mock de DynamoDB y verificar serialización/deserialización fiel
    - **Validates: Requirements 8.15, 8.16, 8.17**

- [x] 28. Checkpoint final Día 2
  - Ensure all tests pass, ask the user if questions arise.
  - Verificar `cdk synth`, `npx vitest --run` y que todos los componentes del Día 2 están integrados.
  - Verificar que el template CloudFormation incluye la variable `BEDROCK_INFERENCE_PROFILE_ID` y la policy `bedrock:InvokeModel`.

## Notes

- Tasks marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido
- Cada task referencia requirements específicos para trazabilidad
- Los checkpoints aseguran validación incremental
- El lenguaje de implementación es TypeScript (CDK + Lambda)
- Las tasks 13 y 14 son stretch goals (Fase 2) y van al final intencionalmente
- Los tests de propiedad (fast-check) son Fase 2 y no se incluyen en este plan P0/P1
- Las tasks 16-28 corresponden al Día 2 (Requirement 8: Enriquecimiento con Bedrock)
- Property tests usan `fast-check` con mínimo 100 iteraciones por propiedad
- El enricher es resiliente por diseño: cualquier fallo de Bedrock activa fallback sin romper el pipeline

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1"] },
    { "id": 3, "tasks": ["4.1"] },
    { "id": 4, "tasks": ["5.1", "6.1", "7.1"] },
    { "id": 5, "tasks": ["8.1"] },
    { "id": 6, "tasks": ["10.1"] },
    { "id": 7, "tasks": ["11.1", "11.2", "11.3", "11.4"] },
    { "id": 8, "tasks": ["13.1"] },
    { "id": 9, "tasks": ["14.1"] },
    { "id": 10, "tasks": ["16.1", "16.2"] },
    { "id": 11, "tasks": ["17.1", "22.1"] },
    { "id": 12, "tasks": ["18.1", "18.2", "18.3"] },
    { "id": 13, "tasks": ["18.4", "18.5"] },
    { "id": 14, "tasks": ["18.6"] },
    { "id": 15, "tasks": ["20.1", "21.1"] },
    { "id": 16, "tasks": ["24.1", "25.1", "25.2", "25.3"] },
    { "id": 17, "tasks": ["26.1", "26.2", "26.3", "26.4", "26.5", "26.6"] },
    { "id": 18, "tasks": ["27.1"] }
  ]
}
```
