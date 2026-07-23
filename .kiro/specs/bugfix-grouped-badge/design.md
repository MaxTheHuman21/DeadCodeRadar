# Bugfix: Badge de Agrupación No Propagado a Findings en `remaining`

## Overview

El bug ocurre cuando el enricher divide los findings en `selected` (≤50) y `remaining` (el resto). Los findings en `remaining` reciben `groupId: null` de forma incondicional, rompiendo grupos donde algunos miembros caen en `selected` y otros en `remaining`. La corrección propaga el `groupId` de los findings enriquecidos a los findings en `remaining` que comparten características de agrupación (mismo archivo o archivos relacionados).

Adicionalmente, si Bedrock omite algún finding del array de respuesta, `parseBedrockResponse` asigna `groupId: null` al finding omitido, potencialmente rompiendo un grupo incluso dentro de los `selected`.

## Glossary

- **Bug_Condition (C)**: Un finding pertenece a un grupo (Bedrock le asignó un `groupId` compartido con otro finding) PERO cae en la partición `remaining` del enricher, recibiendo `groupId: null` en vez de su `groupId` real.
- **Property (P)**: Todo finding que pertenece a un grupo debe tener su `groupId` correcto en la salida final, independientemente de si fue procesado por Bedrock o cayó en `remaining`.
- **Preservation**: Los findings que legítimamente no pertenecen a ningún grupo (`groupId: null` asignado intencionalmente por Bedrock) deben seguir sin mostrar badge.
- **enrichFindings**: Función principal en `lambda/enricher.ts` que orquesta la selección, enriquecimiento y combinación de findings.
- **parseBedrockResponse**: Función en `lambda/enricher.ts` que parsea la respuesta JSON de Bedrock y mapea enrichments a findings por índice.
- **countGroups**: Función en el frontend (`testing.tsx`) que cuenta miembros por `groupId` para calcular `groupSize`.

## Bug Details

### Bug Condition

El bug se manifiesta cuando hay más de 50 findings y Bedrock asigna un `groupId` a un finding en `selected`, pero el(los) compañero(s) de grupo caen en `remaining`. El paso 6 de `enrichFindings` asigna `groupId: null` a todos los `remaining`, destruyendo la relación de grupo.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { findings: Finding[], bedrockResponse: BedrockResponse }
  OUTPUT: boolean
  
  LET { selected, remaining } = selectFindingsForEnrichment(input.findings)
  LET enriched = parseBedrockResponse(input.bedrockResponse, selected)
  LET groupIdsFromBedrock = SET of non-null groupId in enriched.enrichedFindings
  
  // Bug: un finding en remaining debería tener un groupId (comparte grupo con un finding en selected)
  // pero recibe null por el mapeo incondicional
  RETURN EXISTS findingInRemaining IN remaining WHERE
    EXISTS findingInSelected IN enriched.enrichedFindings WHERE
      findingInSelected.groupId IS NOT NULL
      AND shouldBeGrouped(findingInRemaining, findingInSelected)
      AND output.groupId(findingInRemaining) = null
END FUNCTION
```

Un caso secundario ocurre dentro de `parseBedrockResponse`: si Bedrock omite un finding de su respuesta (no incluye su `index`), ese finding recibe `groupId: null` aunque otros findings en la respuesta comparten un grupo con él.

### Examples

- `test/classnames.js` (selected, index 3) recibe `groupId: "i9j0k1l2"` de Bedrock. `test/index.js` (remaining, posición 51+) recibe `groupId: null`. El frontend ve `groupSize = 1` para `"i9j0k1l2"` → no muestra badge en ninguno de los dos.
- 60 findings totales, Bedrock agrupa los findings de índices 0 y 1 con `groupId: "abc12345"`. Finding 51 (en remaining) comparte el mismo archivo base → debería tener el mismo groupId, pero recibe null.
- Bedrock responde con 48 de 50 findings (omite índices 2 y 7). Si finding 2 compartía `groupId` con finding 5, finding 2 pierde su groupId → grupo roto.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Findings con `groupId: null` asignado intencionalmente por Bedrock (finding independiente) deben seguir sin badge
- El ordenamiento por confianza en el frontend no se altera
- El fallback completo (cuando Bedrock falla) sigue asignando `groupId: null` a todos
- La funcionalidad de `countGroups` en el frontend no requiere cambios (ya opera correctamente sobre los groupIds que recibe)
- Findings dentro de los primeros 50 que ya se agrupan correctamente siguen funcionando igual

**Scope:**
Todos los inputs donde NO hay findings con groupId compartido que crucen la frontera selected/remaining deben comportarse exactamente igual que antes. Esto incluye:
- Repositorios con ≤50 findings (no hay `remaining`)
- Repositorios donde todos los miembros de cada grupo caen dentro de `selected`
- Repositorios donde Bedrock no asigna ningún groupId (todos null)

## Hypothesized Root Cause

Basado en el análisis del código, las causas raíz son:

1. **Asignación incondicional de `groupId: null` en `remaining`**: En `enrichFindings()`, línea ~247, el mapeo de `remaining` usa un spread literal que siempre pone `groupId: null` sin verificar si algún grupo existente en los enriched debería extenderse a findings en remaining.

2. **No existe lógica de propagación de groupId post-enriquecimiento**: Después de parsear la respuesta de Bedrock, no hay ningún paso que analice si findings no enriquecidos (remaining o omitidos por Bedrock) comparten características con findings agrupados.

3. **`parseBedrockResponse` no propaga groupId a findings omitidos**: Si Bedrock omite un índice de su respuesta, el finding se rellena con null fields sin intentar inferir su grupo de los findings vecinos.

4. **Criterio de agrupación implícito**: Bedrock agrupa findings por proximidad de archivo (exports del mismo archivo, archivos de test relacionados). Este criterio no está codificado en el backend para propagación post-hoc.

## Correctness Properties

Property 1: Bug Condition - Propagación de GroupId a Findings en Remaining

_For any_ conjunto de findings donde Bedrock asigna un `groupId` G a uno o más findings en `selected`, y existen findings en `remaining` que comparten el mismo archivo (file path) con algún miembro del grupo G, la función `enrichFindings` corregida SHALL asignar `groupId = G` a esos findings en `remaining`, de modo que `countGroups` cuente correctamente todos los miembros del grupo.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Findings Sin Grupo Permanecen Sin Badge

_For any_ conjunto de findings donde ningún finding en `remaining` comparte archivo con un finding agrupado en `selected` (o donde hay ≤50 findings totales, o Bedrock no asigna groupIds), la función `enrichFindings` corregida SHALL producir el mismo resultado que la función original, preservando `groupId: null` para findings independientes.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

**File**: `lambda/enricher.ts`

**Function**: `enrichFindings`

**Specific Changes**:

1. **Agregar función auxiliar `propagateGroupIds`**: Después del paso 5 (parse) y antes del paso 6 (combine), implementar una función que:
   - Recibe `enrichedFindings` (del parse) y `remaining` findings
   - Construye un mapa `file → groupId` de los findings enriquecidos que tienen groupId no-null
   - Para cada finding en `remaining`: si su `file` coincide con algún `file` en el mapa, asignar el mismo `groupId`

2. **Modificar el paso 6 de `enrichFindings`**: En vez de asignar `groupId: null` incondicionalmente a los remaining, usar el resultado de la propagación:
   ```typescript
   const groupIdMap = buildGroupIdFileMap(parsed.enrichedFindings);
   const enrichedFindings: EnrichedFinding[] = [
     ...parsed.enrichedFindings,
     ...remaining.map((f): EnrichedFinding => ({
       ...f,
       confidenceScore: null,
       riskExplanation: null,
       groupId: groupIdMap.get(f.file) ?? null,  // ← Propagar groupId por archivo
     })),
   ];
   ```

3. **Función `buildGroupIdFileMap`**: Nueva función exportada que construye un `Map<string, string>` donde la clave es el path del archivo y el valor es el groupId asignado por Bedrock:
   ```typescript
   export function buildGroupIdFileMap(enrichedFindings: EnrichedFinding[]): Map<string, string> {
     const map = new Map<string, string>();
     for (const f of enrichedFindings) {
       if (f.groupId !== null) {
         map.set(f.file, f.groupId);
       }
     }
     return map;
   }
   ```

4. **Mejorar `parseBedrockResponse` para findings omitidos**: Después de construir el `enrichmentMap` y mapear los findings, agregar un paso que propague groupId a findings omitidos por Bedrock que comparten archivo con findings agrupados:
   ```typescript
   // Post-propagation: si un finding fue omitido pero comparte archivo con uno agrupado, heredar groupId
   const fileToGroupId = new Map<string, string>();
   for (const ef of enrichedFindings) {
     if (ef.groupId) fileToGroupId.set(ef.file, ef.groupId);
   }
   for (let i = 0; i < enrichedFindings.length; i++) {
     if (enrichedFindings[i].groupId === null && fileToGroupId.has(enrichedFindings[i].file)) {
       enrichedFindings[i] = { ...enrichedFindings[i], groupId: fileToGroupId.get(enrichedFindings[i].file)! };
     }
   }
   ```

5. **No se requieren cambios en el frontend**: La función `countGroups` ya opera correctamente — cuenta findings por groupId. Si el backend entrega groupIds consistentes, el badge se mostrará correctamente en todos los miembros del grupo.

## Testing Strategy

### Validation Approach

La estrategia de testing sigue dos fases: primero, generar contraejemplos que demuestren el bug en código sin corregir, luego verificar que la corrección funciona y preserva el comportamiento existente.

### Exploratory Bug Condition Checking

**Goal**: Generar contraejemplos que demuestren que findings en `remaining` pierden su `groupId` ANTES de implementar la corrección.

**Test Plan**: Crear tests que simulen >50 findings donde Bedrock asigna groupIds compartidos entre findings en `selected` y findings que caen en `remaining`. Ejecutar sobre código SIN corregir para observar el fallo.

**Test Cases**:
1. **Cross-boundary Group Test**: 55 findings, Bedrock agrupa finding 48 (selected) con finding 52 (remaining) por mismo archivo → remaining pierde groupId (fallará en código sin corregir)
2. **Multiple Groups Split Test**: 60 findings con 3 grupos, cada grupo tiene miembros en ambas particiones (fallará en código sin corregir)
3. **Omitted Finding Test**: 50 findings, Bedrock omite finding index 3 del response, pero finding 3 comparte archivo con finding 5 que tiene groupId (fallará en código sin corregir)

**Expected Counterexamples**:
- `enrichFindings` retorna findings en `remaining` con `groupId: null` cuando deberían tener el groupId de su grupo
- `countGroups` calcula `groupSize = 1` para un grupo que realmente tiene 2+ miembros

### Fix Checking

**Goal**: Verificar que para todos los inputs donde la condición del bug se cumple, la función corregida produce el comportamiento esperado.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := enrichFindings_fixed(input)
  LET groupMembers = findings with same groupId in result
  ASSERT ALL members of a logical group have the SAME non-null groupId
  ASSERT countGroups(result.findings)[groupId] = total members of group
END FOR
```

### Preservation Checking

**Goal**: Verificar que para todos los inputs donde la condición del bug NO se cumple, la función corregida produce el mismo resultado que la original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT enrichFindings_original(input) = enrichFindings_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing con `fast-check` para generar múltiples configuraciones de findings y verificar preservación:
- Generar repositorios con ≤50 findings (no hay remaining)
- Generar repositorios donde ningún grupo cruza la frontera selected/remaining
- Verificar que outputs son idénticos al código original

**Test Plan**: Observar comportamiento en código SIN corregir primero para findings sin bug condition, luego escribir property tests que capturen ese comportamiento.

**Test Cases**:
1. **No Remaining Preservation**: ≤50 findings → sin remaining → output idéntico
2. **No Groups Preservation**: >50 findings pero Bedrock no asigna ningún groupId → remaining sigue con null
3. **Groups Within Selected**: >50 findings, todos los grupos tienen miembros solo en selected → output de selected idéntico

### Unit Tests

- Test de `buildGroupIdFileMap` con findings variados
- Test de `parseBedrockResponse` con findings omitidos y propagación intra-selected
- Test de `enrichFindings` end-to-end con mock de Bedrock
- Test de edge case: mismo archivo con múltiples groupIds (conflicto)

### Property-Based Tests

- Generar arrays aleatorios de findings y respuestas de Bedrock; verificar que todo finding con groupId tiene al menos un compañero con el mismo groupId (grupo ≥ 2) o groupId null
- Generar configuraciones donde remaining comparte archivos con selected; verificar propagación correcta
- Generar configuraciones sin grupos; verificar que output es idéntico al comportamiento original

### Integration Tests

- Test end-to-end con mock de Bedrock que retorna respuesta parcial (omite findings)
- Test con >50 findings reales y verificación de que el badge aparece en ambos miembros del grupo
- Test de fallback: Bedrock falla → todos los findings tienen groupId null (sin badge)
