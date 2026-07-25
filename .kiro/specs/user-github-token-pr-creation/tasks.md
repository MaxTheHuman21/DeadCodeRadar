# Implementation Plan: User GitHub Token & PR Creation

## Overview

Implementación del flujo de token de usuario y creación de PR. Se extiende el handler existente con routing por `rawPath` (`"/"` → análisis, `"/pr"` → creación de PR), se añaden utilidades de seguridad (redaction, token resolution, ownership verification), y se actualiza el frontend con input de token y estados del botón de PR.

## Tasks

## Día 3 — User GitHub Token & PR Creation

- [x] 29. Implementar utilidades de seguridad del token
  - [x] 29.1 Crear `lambda/utils/tokenResolver.ts` — resolución y validación de token
    - Implementar `resolveToken(userToken, envToken)`: retorna `{ token: userToken.trim(), source: "user" }` si userToken es string no vacío/whitespace con length ≤ 255, sino `{ token: envToken, source: "env" }`
    - Implementar `validateUserToken(token)`: retorna mensaje de error si token > 255 chars o tipo inválido, null si válido o ausente
    - Exportar ambas funciones
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 29.2 Crear `lambda/utils/redactor.ts` — redacción de tokens en logs
    - Implementar `redact(input, token)`: reemplaza todas las ocurrencias del token (y substrings de 4+ chars) con `[REDACTED]`. Retorna input sin cambios si token es null/undefined o < 4 chars
    - Implementar `createSafeLogger(token)`: wrapper sobre console.log/console.error/console.warn que aplica redaction antes de escribir
    - Exportar ambas funciones
    - _Requirements: 2.5, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 29.3 Crear `lambda/utils/ownershipVerifier.ts` — verificación de propiedad
    - Implementar `verifyOwnership(token, repoOwner)`: llama a GitHub `GET /user` con timeout de 10s, compara username autenticado con repoOwner (case-insensitive)
    - Retorna `{ verified: true, authenticatedUser }` si match, o `{ verified: false, error: { statusCode, message } }` si falla
    - Mapear errores: 401 → statusCode 401, no-match → 403, network/timeout/otros → 502
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 30. Extender tipos y routing en el handler existente
  - [x] 30.1 Actualizar `lambda/types.ts` — añadir `rawPath` al `LambdaEvent`
    - Añadir campo `rawPath?: string` a la interfaz `LambdaEvent`
    - _Requirements: 6.1_

  - [x] 30.2 Actualizar `lambda/handler.ts` — routing por rawPath y soporte de userGithubToken
    - Añadir routing: si `event.rawPath === "/pr"` → delegar a `handlePrCreation(event)` importado de `./prHandler`
    - Default (rawPath undefined, `"/"`, o cualquier otro) → flujo existente (análisis POST / consulta GET)
    - Modificar `handlePost` para leer `userGithubToken` del body parseado
    - Usar `resolveToken(userGithubToken, process.env.GITHUB_TOKEN)` para determinar token a usar
    - Pasar el token resuelto a `downloadRepo()` en lugar del hardcoded `process.env.GITHUB_TOKEN`
    - Si resolveToken retorna source "user" y GitHub devuelve auth error: retornar error sin fallback a env token
    - Envolver logging con `createSafeLogger(userGithubToken)` para prevenir leaks
    - Validar `userGithubToken` con `validateUserToken()` si está presente → 400 si inválido
    - NO incluir `userGithubToken` en el JobRecord guardado en DynamoDB
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.3, 3.1, 3.3_

- [x] 31. Checkpoint — Verificar compilación de backend con routing
  - Ensure all tests pass, ask the user if questions arise.
  - Verificar que `npx tsc --noEmit` compila sin errores en la carpeta lambda.

- [x] 32. Implementar módulo de creación de PR
  - [x] 32.1 Crear `lambda/prCreator.ts` — orquestador de GitHub API para PRs
    - Implementar `createPullRequest(input: PrCreationInput): Promise<PrCreationResult>`
    - Crear branch `deadcode-radar/cleanup-{first 8 chars of jobId}` desde default branch
    - Aplicar file deletions en un solo commit usando GitHub Trees API
    - Abrir Pull Request con título y body del input
    - Timeout de 30s por llamada a GitHub API
    - Retornar `{ prUrl, branchName }`
    - Mapear errores: 403 → throw con info de permisos, otros → throw con info de fallo
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.8_

  - [x] 32.2 Crear `lambda/prHandler.ts` — handler del endpoint /pr
    - Exportar `handlePrCreation(event: LambdaEvent): Promise<LambdaResponse>`
    - Validar input: body JSON válido, `jobId` presente y UUID v4, `userGithubToken` presente y no vacío (≤ 255 chars)
    - Crear safe logger con `createSafeLogger(userGithubToken)`
    - Recuperar JobRecord de DynamoDB por jobId → 404 si no existe o status ≠ "completed"
    - Llamar `verifyOwnership(token, repoOwner)` → retornar error code apropiado si falla
    - Implementar `getFilesToDelete(findings)`:
      - Caso (a): file tiene al menos un finding con type "unused-file" y confidenceScore "high"
      - Caso (b): TODOS los findings del file son type "unused-export" con confidenceScore "high" Y comparten el mismo groupId no-null
    - Si no hay archivos elegibles o prDescription es null → 422
    - Llamar `createPullRequest()` con datos filtrados
    - Retornar 201 con `{ prUrl, jobId }`
    - NO incluir userGithubToken en ninguna respuesta ni log
    - _Requirements: 2.2, 2.4, 3.2, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 33. Checkpoint — Verificar compilación completa del backend
  - Ensure all tests pass, ask the user if questions arise.
  - Verificar que `npx tsc --noEmit` compila sin errores.

- [x] 34. Tests de propiedad obligatorios (seguridad y lógica core)
  - [x] 34.1 Write property test for token leak prevention
    - **Property 3: Token Never Leaks to Output**
    - Para cualquier token no vacío `t` y cualquier objeto JobRecord/response producido, la serialización JSON NO debe contener `t` como substring
    - Generar tokens aleatorios con fast-check, construir mock JobRecords y responses, verificar ausencia del token
    - **Validates: Requirements 1.5, 2.1, 2.2, 2.3, 2.4**

  - [x] 34.2 Write property test for redaction completeness
    - **Property 4: Redaction Completeness**
    - Para cualquier token `t` de length ≥ 4 y cualquier string `s` que contenga `t`, `redact(s, t)` debe producir output que NO contenga `t` y SÍ contenga `[REDACTED]`
    - Generar tokens y strings que los contienen, verificar eliminación completa
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

  - [x] 34.3 Write property test for ownership verification
    - **Property 5: Ownership Verification Correctness**
    - Para cualquier par de strings `authenticatedUser` y `repoOwner`, ownership pasa sii `authenticatedUser.toLowerCase() === repoOwner.toLowerCase()`
    - Generar pares de strings (iguales case-insensitive, diferentes) y verificar resultado
    - **Validates: Requirements 4.2, 4.3**

  - [x] 34.4 Write property test for high-confidence file filtering
    - **Property 7: High-Confidence File Filtering (Extended)**
    - Para cualquier array de EnrichedFinding, `getFilesToDelete(findings)` retorna file `f` sii:
      - (a) existe finding con `file === f`, `type === "unused-file"`, `confidenceScore === "high"`, O
      - (b) TODOS los findings con `file === f` tienen `type === "unused-export"`, `confidenceScore === "high"`, y comparten el mismo `groupId` no-null
    - Generar arrays de findings con tipos, confidence y groupIds variados; verificar contra implementación de referencia
    - **Validates: Requirements 5.2, 5.7**

- [x] 35. Checkpoint — Verificar property tests pasan
  - Ensure all tests pass, ask the user if questions arise.
  - Ejecutar `npx vitest --run test/property/` para confirmar que los property tests pasan.

- [x] 36. Actualizar frontend — token input y transmisión
  - [x] 36.1 Añadir Token Input a `frontend/src/components/deadcode/testing.tsx`
    - Añadir `useState<string>('')` para `githubToken`
    - Renderizar sección colapsable (`<details>`) con label "Add your GitHub token to enable PR creation (optional)"
    - Incluir link a `https://github.com/settings/tokens/new?scopes=repo` explicando scope `repo`
    - Renderizar `<input type="password">` vinculado al state
    - Al hacer reset, limpiar el token del state
    - NO persistir token en localStorage, sessionStorage, cookies ni ningún otro mecanismo de persistencia
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 12.1, 12.2, 12.3_

  - [x] 36.2 Implementar transmisión del token en la request de análisis
    - Modificar el `fetch` en `analyze()`: si `githubToken.trim()` es no vacío, incluir `userGithubToken: githubToken.trim()` en el body JSON
    - Si token está vacío o solo whitespace: NO incluir campo `userGithubToken` en el body
    - Mantener Content-Type: application/json
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 37. Actualizar frontend — PR button state y creación
  - [x] 37.1 Refactorizar `frontend/src/components/deadcode/pr-card.tsx` con estado de PR
    - Pasar `githubToken` y `jobId` como props al componente PrCard
    - Implementar lógica de disabled: botón disabled si token vacío/whitespace O prDescription es null
    - Añadir tooltip cuando disabled: "Add your GitHub token above to enable this"
    - On click (enabled): POST a `${API_URL}/pr` con `{ jobId, userGithubToken: githubToken.trim() }`
    - Estado success: reemplazar botón con check verde + "PR Created" + link clickable (target="_blank", rel="noopener noreferrer")
    - Estado error: mapear mensajes según response (403 "does not own" → "You don't own this repository", 403 "write access" → "You don't have write access", network error → "Network error — please try again")
    - Permitir dismiss de error y retry
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 10.1, 10.2, 11.1, 11.2, 11.3, 11.4_

  - [x] 37.2 Conectar token al PrCard desde Testing component
    - Pasar `githubToken` y `result.jobId` como props a `<PrCard>` en el componente Results
    - Actualizar la interfaz de props de PrCard para aceptar los nuevos campos
    - _Requirements: 9.1, 9.3_

- [ ] 38. Tests de propiedad opcionales (stretch)
  - [ ]* 38.1 Write property test for token resolution
    - **Property 1: Token Resolution**
    - Para cualquier input string `userToken` y `envToken`, verificar que resolveToken retorna source "user" con token trimmed si userToken es no-vacío/whitespace y ≤ 255, sino source "env"
    - **Validates: Requirements 1.1, 1.2**

  - [ ]* 38.2 Write property test for token length validation
    - **Property 2: Token Length Validation**
    - Para cualquier string > 255 chars, validateUserToken retorna error. Para string ≤ 255 con no-whitespace, retorna null
    - **Validates: Requirements 1.3, 6.1**

  - [ ]* 38.3 Write property test for branch name construction
    - **Property 6: Branch Name Construction**
    - Para cualquier UUID v4, branch name === `"deadcode-radar/cleanup-"` + primeros 8 chars del jobId
    - **Validates: Requirements 5.1**

  - [ ]* 38.4 Write property test for frontend token transmission
    - **Property 8: Frontend Token Transmission**
    - Para cualquier string `token`, request body incluye `userGithubToken: token.trim()` si `token.trim().length > 0`, omite el campo si `token.trim().length === 0`
    - **Validates: Requirements 8.1, 8.2**

  - [ ]* 38.5 Write property test for PR button state
    - **Property 9: PR Button Enabled State**
    - PR button enabled sii `token.trim().length > 0` AND `prDescription !== null`
    - **Validates: Requirements 9.1, 9.3, 9.4**

- [x] 39. Checkpoint final Día 3
  - Ensure all tests pass, ask the user if questions arise.
  - Verificar `npx tsc --noEmit`, `npx vitest --run` y que todos los componentes del Día 3 están integrados.
  - Verificar que el routing por rawPath funciona: `"/"` → análisis, `"/pr"` → PR creation.

## Notes

- Tasks marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido
- Cada task referencia requirements específicos para trazabilidad
- Los checkpoints aseguran validación incremental
- El lenguaje de implementación es TypeScript (Lambda + React frontend)
- NO se requieren cambios CDK — el routing se hace en handler.ts por event.rawPath
- El prHandler.ts es un MÓDULO exportando `handlePrCreation()`, NO un entry point de Lambda separado
- `getFilesToDelete()` incluye lógica extendida validada con fixtures reales (caso a: unused-file high, caso b: todos unused-export high con mismo groupId)
- Property tests obligatorios (34.1-34.4) son de seguridad y lógica core — no se marcan con `*`
- Property tests opcionales (38.1-38.5) son stretch y se marcan con `*`
- El token NUNCA se persiste: ni en DynamoDB, ni en logs, ni en responses, ni en browser storage

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["29.1", "29.2", "29.3", "30.1"] },
    { "id": 1, "tasks": ["30.2"] },
    { "id": 2, "tasks": ["32.1"] },
    { "id": 3, "tasks": ["32.2"] },
    { "id": 4, "tasks": ["34.1", "34.2", "34.3", "34.4"] },
    { "id": 5, "tasks": ["36.1"] },
    { "id": 6, "tasks": ["36.2", "37.1"] },
    { "id": 7, "tasks": ["37.2"] },
    { "id": 8, "tasks": ["38.1", "38.2", "38.3", "38.4", "38.5"] }
  ]
}
```
