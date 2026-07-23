# Requirements Document

## Introduction

DeadCode Radar es una herramienta de productividad para desarrolladores que analiza repositorios públicos de GitHub (JavaScript/TypeScript) en busca de código muerto: funciones no utilizadas, exports sin consumir y archivos huérfanos. Este documento cubre el backend MVP del Día 1 del hackathon de 4 días: un pipeline end-to-end desplegado en AWS Lambda que recibe una URL de repositorio, descarga los archivos fuente, ejecuta análisis de código muerto y devuelve los hallazgos en formato JSON.

## Glossary

- **Sistema_Análisis**: El sistema backend completo de DeadCode Radar, compuesto por la Lambda Function, el módulo de descarga y el motor de análisis.
- **Lambda_Function**: La función AWS Lambda expuesta mediante Function URL que recibe y procesa las solicitudes HTTP.
- **Módulo_Descarga**: Componente responsable de obtener archivos .js/.ts/.jsx/.tsx del repositorio usando la API REST de GitHub (Octokit).
- **Motor_Análisis**: Componente que ejecuta el análisis de código muerto usando la librería knip (o ts-prune como alternativa).
- **Tabla_Resultados**: Tabla de DynamoDB donde se persisten los resultados de análisis con un identificador único (jobId).
- **Solicitud_Análisis**: Petición HTTP POST con payload JSON conteniendo la URL del repositorio a analizar.
- **Resultado_Análisis**: Objeto JSON que contiene los hallazgos de código muerto encontrados en el repositorio, opcionalmente enriquecidos con metadatos de IA.
- **GITHUB_TOKEN**: Variable de entorno que contiene un token de acceso personal de GitHub para evitar límites de tasa de la API.
- **jobId**: Identificador único (UUID v4) asignado a cada análisis ejecutado.
- **Capa_Enriquecimiento**: Capa de procesamiento posterior al análisis que utiliza Amazon Bedrock para añadir contexto semántico, agrupación y puntuación de confianza a los hallazgos crudos del Motor_Análisis.
- **Motor_IA**: Cliente de Amazon Bedrock Runtime que realiza una única invocación al modelo de lenguaje para enriquecer el conjunto completo de hallazgos de un análisis.
- **Perfil_Inferencia**: Identificador del perfil de inferencia de Amazon Bedrock (variable de entorno `BEDROCK_INFERENCE_PROFILE_ID`) utilizado para invocar el modelo; valor por defecto: `us.anthropic.claude-sonnet-4-6`.
- **Hallazgo_Enriquecido**: Un hallazgo del Motor_Análisis extendido con campos de confianza (`confidenceScore`), explicación de riesgo (`riskExplanation`) y grupo opcional (`groupId`).
- **PR_Descripción**: Texto generado por el Motor_IA que contiene un título y cuerpo formateado para una Pull Request que resuma las eliminaciones sugeridas.

## Requirements

### Requirement 1: Recepción de solicitudes de análisis

**User Story:** Como desarrollador, quiero enviar una URL de repositorio público de GitHub a un endpoint HTTP, para que el sistema inicie un análisis de código muerto sobre ese repositorio.

#### Acceptance Criteria

1. THE Lambda_Function SHALL exponer un endpoint HTTP accesible mediante AWS Lambda Function URL (sin API Gateway) que acepte métodos POST y GET con el siguiente ruteo: POST inicia un nuevo análisis, GET consulta un resultado existente por jobId.
2. WHEN la Lambda_Function recibe una solicitud POST con payload JSON `{ "repoUrl": "<url>" }`, THE Lambda_Function SHALL validar que el campo `repoUrl` está presente y es una URL válida de GitHub con formato `https://github.com/{owner}/{repo}`.
3. WHEN la Lambda_Function recibe una solicitud POST válida, THE Lambda_Function SHALL generar un jobId único (UUID v4), ejecutar el pipeline de análisis y retornar una respuesta HTTP 200 con el Resultado_Análisis completo.
4. IF el campo `repoUrl` está ausente o tiene formato inválido en una solicitud POST, THEN THE Lambda_Function SHALL retornar HTTP 400 con cuerpo JSON `{ "error": "<descripción>" }`.
5. IF el body de la solicitud POST no es JSON válido o está vacío, THEN THE Lambda_Function SHALL retornar HTTP 400 con cuerpo JSON `{ "error": "El cuerpo de la solicitud debe ser JSON válido" }`.
6. IF la Lambda_Function recibe un método HTTP diferente a POST o GET, THEN THE Lambda_Function SHALL retornar HTTP 405 con cuerpo JSON `{ "error": "Método no permitido" }`.
7. THE Lambda_Function SHALL interpretar solicitudes GET exclusivamente como consultas de resultados existentes (ver Requirement 5); una solicitud GET nunca iniciará un nuevo análisis.

---

### Requirement 2: Descarga de archivos fuente del repositorio

**User Story:** Como desarrollador, quiero que el sistema descargue únicamente archivos JavaScript y TypeScript del repositorio junto con los archivos de configuración necesarios para el análisis, para que knip pueda ejecutarse correctamente dentro de los límites de Lambda.

#### Acceptance Criteria

1. WHEN el Módulo_Descarga recibe una URL de repositorio válida, THE Módulo_Descarga SHALL obtener el árbol de archivos del repositorio usando la API REST de GitHub (Octokit).
2. WHEN el Módulo_Descarga procesa el árbol de archivos, THE Módulo_Descarga SHALL descargar los archivos con extensiones .js, .ts, .jsx y .tsx, hasta un máximo de 500 archivos de código fuente elegibles.
3. THE Módulo_Descarga SHALL descargar obligatoriamente el archivo `package.json` de la raíz del repositorio, ya que es requerido por knip para ejecutar el análisis.
4. THE Módulo_Descarga SHALL descargar opcionalmente los siguientes archivos de configuración de la raíz del repositorio si existen: `tsconfig.json`, `knip.json`, `knip.config.ts` y `knip.config.js`.
5. THE Módulo_Descarga SHALL utilizar el GITHUB_TOKEN configurado como variable de entorno para autenticar las llamadas a la API de GitHub.
6. IF el repositorio no contiene un archivo `package.json` en la raíz, THEN THE Módulo_Descarga SHALL propagar un error con mensaje indicando que el repositorio no es un proyecto Node.js válido (HTTP 422).
7. IF el repositorio no existe o retorna HTTP 404, THEN THE Módulo_Descarga SHALL propagar un error con mensaje indicando que el repositorio no fue encontrado.
8. IF el repositorio es privado (HTTP 403), THEN THE Módulo_Descarga SHALL propagar un error con mensaje indicando que el repositorio es privado o inaccesible.
9. IF el repositorio no contiene archivos con extensiones .js, .ts, .jsx o .tsx, THEN THE Módulo_Descarga SHALL propagar un error con mensaje indicando que no se encontraron archivos JavaScript/TypeScript en el repositorio.
10. WHEN el Módulo_Descarga filtra el árbol de archivos, THE Módulo_Descarga SHALL descartar archivos dentro de directorios `node_modules`, `dist`, `build` y `.git`.
11. IF la variable de entorno GITHUB_TOKEN no está configurada o la API de GitHub retorna HTTP 401, THEN THE Módulo_Descarga SHALL propagar un error con mensaje indicando que la autenticación con GitHub falló.
12. IF la API de GitHub retorna HTTP 429 o la solicitud excede un tiempo de espera de 30 segundos, THEN THE Módulo_Descarga SHALL propagar un error con mensaje indicando que el servicio de GitHub no está disponible temporalmente.
13. IF el número de archivos de código fuente elegibles en el repositorio excede 500, THEN THE Módulo_Descarga SHALL propagar un error con mensaje indicando que el repositorio excede el límite de archivos permitido.

---

### Requirement 3: Análisis de código muerto

**User Story:** Como desarrollador, quiero que el sistema ejecute un análisis de código muerto sobre los archivos descargados, para identificar funciones, exports y archivos sin utilizar.

#### Acceptance Criteria

1. WHEN el Motor_Análisis recibe los archivos descargados en el directorio temporal de Lambda, THE Motor_Análisis SHALL ejecutar el análisis de código muerto usando la librería knip.
2. THE Motor_Análisis SHALL identificar los siguientes tipos de código muerto con valores enumerados para el campo `type`: `unused-export` (exports no utilizados), `unused-file` (archivos no utilizados) y `unused-dependency` (dependencias no utilizadas).
3. WHEN el Motor_Análisis completa el análisis, THE Motor_Análisis SHALL generar un Resultado_Análisis con un array de hallazgos donde cada hallazgo incluya: `file` (ruta relativa al repositorio), `line` (número de línea o `null` si no está disponible), `type` (uno de los valores enumerados) y `name` (identificador del símbolo muerto).
4. IF la librería knip falla o no es compatible con el entorno Lambda, THEN THE Motor_Análisis SHALL intentar el análisis con ts-prune como alternativa.
5. IF tanto knip como ts-prune fallan en el entorno Lambda, THEN THE Motor_Análisis SHALL propagar un error con mensaje indicando que el motor de análisis no pudo ejecutarse.
6. IF el análisis excede el timeout configurado de la Lambda (5 minutos), THEN THE Lambda_Function SHALL retornar HTTP 504 con mensaje "Tiempo de análisis excedido para este repositorio".

---

### Requirement 4: Persistencia de resultados

**User Story:** Como desarrollador, quiero que los resultados de cada análisis se guarden con un identificador único, para poder consultarlos posteriormente.

#### Acceptance Criteria

1. WHEN el análisis se completa exitosamente, THE Sistema_Análisis SHALL guardar el Resultado_Análisis en la Tabla_Resultados con el jobId como clave primaria.
2. THE Sistema_Análisis SHALL almacenar en la Tabla_Resultados los campos: `jobId` (String), `repoUrl` (String), `status` ("completed" o "error"), `findings` (array JSON serializado), `createdAt` (timestamp ISO 8601) y `filesAnalyzed` (Number).
3. IF ocurre un error durante el análisis, THEN THE Sistema_Análisis SHALL guardar el registro en la Tabla_Resultados con status "error" y un campo `errorMessage` que contenga el mensaje de error propagado por el componente que falló.
4. IF la escritura a DynamoDB falla, THEN THE Lambda_Function SHALL registrar el error en CloudWatch Logs y retornar HTTP 500, incluyendo el jobId en la respuesta para facilitar la depuración.
5. (Fase 2 / Stretch Goal) IF el tamaño del item a guardar excede 400 KB (límite de DynamoDB), THEN THE Sistema_Análisis SHALL truncar el array `findings` conservando los primeros hallazgos y añadiendo un campo `truncated: true` al registro.

---

### Requirement 5: Consulta de resultados por jobId (Fase 2 / Stretch Goal)

**User Story:** Como desarrollador, quiero consultar el resultado de un análisis previo por su jobId, para no tener que ejecutar el análisis nuevamente.

**Nota:** Este requirement es un stretch goal para el Día 1. Las tasks de implementación deben generarse al final de la lista, después de que el flujo principal (POST → descarga → análisis → persistencia → respuesta) esté completo y probado.

#### Acceptance Criteria

1. WHEN la Lambda_Function recibe una solicitud HTTP GET con el query parameter `jobId` (formato UUID v4), THE Lambda_Function SHALL buscar el registro correspondiente en la Tabla_Resultados y retornar HTTP 200 con el cuerpo JSON conteniendo los campos: `jobId`, `repoUrl`, `status`, `findings`, `createdAt` y `filesAnalyzed`.
2. IF el jobId proporcionado no existe en la Tabla_Resultados, THEN THE Lambda_Function SHALL retornar HTTP 404 con cuerpo `{ "error": "Resultado no encontrado para el jobId proporcionado" }`.
3. IF la solicitud HTTP GET no incluye el query parameter `jobId` o el valor no tiene formato UUID v4 válido, THEN THE Lambda_Function SHALL retornar HTTP 400 con un mensaje de error en formato JSON indicando que el jobId es requerido y debe ser un UUID v4.
4. IF la Lambda_Function no puede conectarse a la Tabla_Resultados al procesar una consulta GET, THEN THE Lambda_Function SHALL retornar HTTP 500 con cuerpo `{ "error": "Error interno del servidor" }`.

---

### Requirement 6: Infraestructura como código

**User Story:** Como desarrollador, quiero que toda la infraestructura esté definida con AWS CDK en TypeScript, para desplegar y reproducir el entorno de forma consistente.

#### Acceptance Criteria

1. THE Sistema_Análisis SHALL definir toda la infraestructura en un único stack de AWS CDK con TypeScript, desplegable mediante un solo comando `cdk deploy`.
2. THE Sistema_Análisis SHALL crear una Lambda Function con Node.js 20.x runtime, 1024 MB de memoria y timeout de 5 minutos.
3. THE Sistema_Análisis SHALL crear una tabla DynamoDB con `jobId` (String) como partition key, modo de capacidad on-demand y RemovalPolicy DESTROY.
4. THE Sistema_Análisis SHALL configurar la Lambda Function URL con tipo de autenticación NONE y CORS habilitado para todos los orígenes y métodos POST y GET.
5. THE Sistema_Análisis SHALL pasar el GITHUB_TOKEN como variable de entorno de la Lambda Function.
6. THE Sistema_Análisis SHALL otorgar permisos de lectura y escritura sobre la Tabla_Resultados a la Lambda_Function.
7. WHEN el despliegue se completa exitosamente, THE Sistema_Análisis SHALL emitir la URL de la Lambda Function como un CfnOutput del stack con nombre lógico `FunctionUrl`.

---

### Requirement 7: Manejo de errores y respuestas HTTP

**User Story:** Como desarrollador, quiero recibir mensajes de error claros y códigos HTTP apropiados, para diagnosticar rápidamente problemas al usar la API.

#### Acceptance Criteria

1. THE Lambda_Function SHALL retornar todas las respuestas con Content-Type `application/json`.
2. WHEN el análisis se completa exitosamente, THE Lambda_Function SHALL retornar HTTP 200 con el cuerpo: `{ "jobId": "<uuid>", "status": "completed", "repoUrl": "<url>", "filesAnalyzed": <número>, "findings": [...] }`.
3. THE Lambda_Function SHALL mapear errores a los siguientes códigos HTTP: 400 (input inválido), 401 (autenticación con GitHub fallida), 403 (repositorio privado), 404 (repositorio o jobId no encontrado), 405 (método no permitido), 422 (repositorio sin archivos JS/TS, sin package.json o excede límite), 503 (servicio de GitHub no disponible), 504 (timeout) y 500 (error interno inesperado).
4. IF ocurre un error interno inesperado, THEN THE Lambda_Function SHALL retornar HTTP 500 con cuerpo `{ "error": "Error interno del servidor", "jobId": "<uuid si disponible>" }`.
5. THE Lambda_Function SHALL registrar todos los errores en CloudWatch Logs con el jobId, el mensaje de error y el stack trace.
6. IF la Lambda_Function recibe un método HTTP diferente a POST o GET, THEN THE Lambda_Function SHALL retornar HTTP 405 con cuerpo `{ "error": "Método no permitido" }`.


---

### Requirement 8: Enriquecimiento de hallazgos con Amazon Bedrock

**User Story:** Como desarrollador, quiero que los hallazgos de código muerto incluyan una puntuación de confianza, una explicación en lenguaje natural del riesgo de eliminación y una descripción de PR lista para usar, para priorizar la limpieza del código con contexto semántico generado por IA.

#### Acceptance Criteria

##### Invocación y entrada al Motor_IA

1. WHEN el Motor_Análisis completa el análisis y genera hallazgos, THE Capa_Enriquecimiento SHALL invocar al Motor_IA realizando UNA ÚNICA llamada a Amazon Bedrock con el conjunto completo de hallazgos del análisis (no una llamada por hallazgo individual).
2. THE Motor_IA SHALL utilizar el SDK `@aws-sdk/client-bedrock-runtime` con la acción `InvokeModel` y el perfil de inferencia configurado en la variable de entorno `BEDROCK_INFERENCE_PROFILE_ID`.
3. WHEN la Capa_Enriquecimiento construye el prompt para el Motor_IA, THE Capa_Enriquecimiento SHALL incluir el contenido relevante del archivo (o un fragmento de contexto alrededor de la línea señalada) para cada hallazgo, leyendo los archivos desde el directorio temporal `/tmp/{jobId}` ya disponible del paso de descarga.
4. THE Capa_Enriquecimiento SHALL enviar un system prompt que instruya explícitamente al modelo a responder en formato JSON estructurado, especificando el esquema esperado de la respuesta.

##### Agrupación de hallazgos

5. WHEN el Motor_IA procesa los hallazgos, THE Motor_IA SHALL agrupar hallazgos relacionados asignando un `groupId` compartido en los siguientes casos: múltiples exports no utilizados provenientes del mismo archivo, o un archivo completamente no utilizado cuyo contenido también generó hallazgos individuales de exports.
6. WHEN el Motor_IA asigna un `groupId`, THE Motor_IA SHALL utilizar un identificador alfanumérico corto (8 caracteres) que vincule los hallazgos del mismo grupo lógico.

##### Puntuación de confianza

7. WHEN el Motor_IA evalúa cada hallazgo o grupo, THE Motor_IA SHALL asignar un campo `confidenceScore` con valor `"high"`, `"medium"` o `"low"`, reflejando la certeza de que el código es efectivamente código muerto y no un falso positivo.
8. THE Motor_IA SHALL asignar confianza `"high"` cuando el hallazgo es un archivo sin importaciones entrantes ni exports consumidos; `"medium"` cuando el export podría tener consumidores dinámicos o en pruebas; y `"low"` cuando existe ambigüedad (re-exports, plugins, o patrones de carga dinámica).

##### Explicación de riesgo

9. WHEN el Motor_IA evalúa cada hallazgo o grupo, THE Motor_IA SHALL generar un campo `riskExplanation` con una explicación en lenguaje natural de 1 a 2 oraciones que indique por qué el hallazgo es candidato a eliminación y qué riesgo existe al borrarlo.

##### Generación de descripción de PR

10. WHEN el Motor_IA completa el enriquecimiento de todos los hallazgos, THE Motor_IA SHALL generar un campo `prDescription` a nivel del análisis completo, conteniendo un objeto con `title` (máximo 72 caracteres) y `body` (formato Markdown) que resuma las eliminaciones sugeridas agrupadas por tipo y archivo.

##### Fallback obligatorio

11. IF la invocación a Amazon Bedrock falla (error de red, timeout, error del modelo, respuesta malformada o cualquier excepción), THEN THE Capa_Enriquecimiento SHALL retornar los hallazgos originales SIN enriquecimiento, con `confidenceScore` establecido en `null`, `riskExplanation` en `null`, `groupId` en `null` y `prDescription` en `null`; el pipeline completo NO SHALL fallar por un error de Bedrock.
12. IF la respuesta del Motor_IA no es JSON válido o no cumple el esquema esperado, THEN THE Capa_Enriquecimiento SHALL aplicar el mismo fallback del criterio anterior y registrar el error en CloudWatch Logs con nivel WARNING.

##### Configuración e IAM

13. THE Sistema_Análisis SHALL definir la variable de entorno `BEDROCK_INFERENCE_PROFILE_ID` en la Lambda_Function (valor por defecto: `us.anthropic.claude-sonnet-4-6`), permitiendo cambiar el modelo sin redespliegue de código.
14. THE Sistema_Análisis SHALL otorgar el permiso IAM `bedrock:InvokeModel` al rol de ejecución de la Lambda_Function, con el recurso limitado al perfil de inferencia configurado.

##### Esquema de datos actualizado

15. WHEN el análisis se completa con enriquecimiento, THE Sistema_Análisis SHALL persistir en la Tabla_Resultados cada hallazgo con los campos adicionales: `confidenceScore` (String | null: `"high"`, `"medium"`, `"low"`), `riskExplanation` (String | null) y `groupId` (String | null, opcional).
16. WHEN el análisis se completa con enriquecimiento, THE Sistema_Análisis SHALL persistir en la Tabla_Resultados el campo `prDescription` (objeto con `title`: String y `body`: String, o `null`) a nivel del registro principal del job (JobRecord).
17. THE Sistema_Análisis SHALL mantener compatibilidad retroactiva: los registros existentes sin campos de enriquecimiento seguirán siendo válidos y consultables sin error.

##### Respuesta HTTP actualizada

18. WHEN el análisis con enriquecimiento se completa exitosamente, THE Lambda_Function SHALL retornar HTTP 200 con el cuerpo JSON conteniendo la estructura: `{ "jobId": "<uuid>", "status": "completed", "repoUrl": "<url>", "filesAnalyzed": <número>, "enriched": true, "findings": [{ "file": "<ruta>", "line": <número|null>, "type": "<tipo>", "name": "<símbolo>", "confidenceScore": "<high|medium|low>", "riskExplanation": "<texto>", "groupId": "<id|null>" }], "prDescription": { "title": "<título>", "body": "<markdown>" } }`.
19. WHEN el análisis se completa pero el enriquecimiento falla (fallback activo), THE Lambda_Function SHALL retornar HTTP 200 con el cuerpo JSON conteniendo la estructura: `{ "jobId": "<uuid>", "status": "completed", "repoUrl": "<url>", "filesAnalyzed": <número>, "enriched": false, "findings": [{ "file": "<ruta>", "line": <número|null>, "type": "<tipo>", "name": "<símbolo>", "confidenceScore": null, "riskExplanation": null, "groupId": null }], "prDescription": null }`.

##### Secuencia del pipeline (modificación al handler existente del Día 1)

20. THE Lambda_Function SHALL ejecutar el pipeline de análisis POST en el siguiente orden estricto: (1) descargar repositorio a `/tmp/{jobId}`, (2) ejecutar análisis con knip sobre `/tmp/{jobId}`, (3) ejecutar enriquecimiento con Bedrock leyendo archivos desde `/tmp/{jobId}` (directorio aún disponible), (4) limpiar directorio `/tmp/{jobId}`, (5) persistir resultado en Tabla_Resultados, (6) retornar respuesta HTTP. ESTO CONSTITUYE UNA MODIFICACIÓN al handler existente implementado en el Día 1, donde la limpieza de `/tmp/{jobId}` (paso 4) ocurre actualmente en un bloque `try/finally` inmediatamente después del paso de análisis (paso 2); la limpieza DEBE reubicarse para ejecutarse DESPUÉS del enriquecimiento (paso 3), garantizando que la Capa_Enriquecimiento tenga acceso a los archivos fuente del repositorio.

##### Timeout de invocación a Bedrock

21. IF la invocación al Motor_IA a través de Amazon Bedrock excede un tiempo de espera de 60 segundos, THEN THE Capa_Enriquecimiento SHALL abortar la llamada y aplicar el mismo fallback definido en el criterio 11 (hallazgos retornados sin enriquecimiento con campos `confidenceScore`, `riskExplanation`, `groupId` y `prDescription` en `null`); este timeout de 60 segundos es independiente del timeout general de 5 minutos de la Lambda_Function y tiene como propósito prevenir que una respuesta lenta de Bedrock consuma el presupuesto de tiempo completo de la Lambda resultando en un HTTP 504.

##### Límite de contexto para repositorios grandes

22. IF el número de hallazgos generados por el Motor_Análisis excede 50, THEN THE Capa_Enriquecimiento SHALL seleccionar los primeros 50 hallazgos ordenados alfabéticamente por el campo `file` para recibir enriquecimiento completo con contexto de archivo en el prompt de Bedrock; los hallazgos restantes SHALL incluirse en la respuesta con `confidenceScore` en `null`, `riskExplanation` en `null` y `groupId` en `null` (misma estructura que el fallback del criterio 11).
23. THE Capa_Enriquecimiento SHALL limitar el payload total de contexto enviado al Motor_IA a un máximo de 100,000 caracteres; IF el contexto acumulado de los 50 hallazgos seleccionados excede este límite, THEN THE Capa_Enriquecimiento SHALL truncar el contenido de archivo incluido en el prompt (preservando los metadatos del hallazgo) hasta que el payload total sea menor o igual a 100,000 caracteres.

##### Presupuesto de tiempo del pipeline

24. THE Motor_Análisis SHALL aplicar un timeout de 180 segundos (3 minutos) para la ejecución de knip (o ts-prune como alternativa), en lugar de los 240 segundos configurados actualmente en la implementación del Día 1 (Task 6.1). ESTO CONSTITUYE UNA MODIFICACIÓN al valor de timeout ya implementado; la reducción de 240s a 180s es necesaria para garantizar un colchón de ~2 minutos para el resto del pipeline (descarga, enriquecimiento Bedrock de 60s máximo, limpieza, persistencia y respuesta) dentro del timeout total de 5 minutos (300s) de la Lambda_Function.

##### Estado de enriquecimiento parcial

25. THE Lambda_Function SHALL establecer el campo `enriched` en `true` cuando al menos un hallazgo fue enriquecido exitosamente por el Motor_IA (incluyendo el escenario de enriquecimiento parcial del criterio 22, donde solo los primeros 50 hallazgos reciben enriquecimiento y el resto mantiene campos en `null`). THE Lambda_Function SHALL establecer `enriched` en `false` exclusivamente cuando la llamada a Bedrock falló por completo o fue abortada (criterios 11, 12 y 21), es decir, cuando ningún hallazgo fue enriquecido.
