# Tareas de Implementación

## 1. Corregir `parseKnipOutput` en `lambda/analyzer.ts`

- [x] 1.1 Reescribir la función `parseKnipOutput` para parsear `parsed.files` como array de strings y generar findings `type: "unused-file"`
- [x] 1.2 Parsear `parsed.issues` como array de objetos per-file
- [x] 1.3 Extraer dependencias (`dependencies`, `devDependencies`, `optionalPeerDependencies`, `unlisted`, `binaries`) de cada issue y generar findings `type: "unused-dependency"`
- [x] 1.4 Extraer exports (`exports`, `types`, `nsExports`, `nsTypes`, `classMembers`, `enumMembers`, `duplicates`) de cada issue y generar findings `type: "unused-export"`

## 2. Agregar test unitario

- [x] 2.1 Agregar test que usa el formato real de knip JSON (con `issues[]` conteniendo `dependencies`)
- [x] 2.2 Verificar que el resultado incluye findings `type: "unused-dependency"` con el nombre correcto
- [x] 2.3 Verificar que el resultado incluye findings `type: "unused-export"` del array `issues[].exports`
- [x] 2.4 Verificar que `files` de primer nivel sigue generando findings `type: "unused-file"`

## 3. Verificación

- [x] 3.1 Ejecutar `npx vitest --run` y verificar que todos los tests pasan
- [x] 3.2 Ejecutar `npx tsc --noEmit` y verificar que TypeScript compila sin errores
