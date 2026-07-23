# Diseño del Bugfix — Parseo de Dependencias Knip

## Contexto Técnico

El archivo `lambda/analyzer.ts` contiene la función `parseKnipOutput` que transforma la salida JSON de knip en un array de `Finding[]`. El formato real de knip (`--reporter json`) tiene esta estructura:

```json
{
  "files": ["ruta/archivo.ts", ...],
  "issues": [
    {
      "file": "package.json",
      "dependencies": [{"name": "lodash"}],
      "devDependencies": [{"name": "ts-node"}],
      "exports": [],
      "types": [],
      ...
    },
    {
      "file": "lambda/enricher.ts",
      "exports": [{"name": "helperFn", "line": 43, "col": 14, "pos": 1544}],
      "types": [{"name": "SomeType", "line": 10, "col": 18, "pos": 200}],
      ...
    }
  ]
}
```

La implementación actual itera `Object.entries(parsed)` buscando claves como `dependencies`, `exports` etc. en el primer nivel. Pero solo `files` existe a ese nivel — el resto está anidado en cada objeto de `issues[]`.

## Diseño de la Solución

### Cambio en `parseKnipOutput`

Reescribir la función para manejar ambas secciones del JSON:

1. **`parsed.files`** (primer nivel): Array de strings → findings `type: "unused-file"`
2. **`parsed.issues`** (primer nivel): Array de objetos per-file, cada uno con:
   - `file`: archivo fuente del issue
   - `dependencies`, `devDependencies`, `optionalPeerDependencies`, `unlisted`, `binaries`: arrays de `{name: string}` → findings `type: "unused-dependency"`, `file: "package.json"`
   - `exports`, `types`, `nsExports`, `nsTypes`, `classMembers`, `enumMembers`: arrays de `{name: string, line?: number}` → findings `type: "unused-export"`, con el `file` del issue padre

### Pseudocódigo

```
FUNCTION parseKnipOutput(jsonOutput: string): Finding[]
  parsed ← JSON.parse(jsonOutput)
  findings ← []

  // 1. Archivos no usados (primer nivel)
  IF parsed.files IS array THEN
    FOR EACH filePath IN parsed.files
      findings.push({ file: filePath, line: null, type: "unused-file", name: basename(filePath) })

  // 2. Issues anidados
  IF parsed.issues IS array THEN
    FOR EACH issue IN parsed.issues
      issueFile ← issue.file

      // Dependencias → type: "unused-dependency"
      FOR EACH depKey IN ["dependencies", "devDependencies", "optionalPeerDependencies", "unlisted", "binaries"]
        IF issue[depKey] IS array THEN
          FOR EACH dep IN issue[depKey]
            findings.push({ file: "package.json", line: null, type: "unused-dependency", name: dep.name })

      // Exports → type: "unused-export"
      FOR EACH exportKey IN ["exports", "types", "nsExports", "nsTypes", "classMembers", "enumMembers", "duplicates"]
        IF issue[exportKey] IS array THEN
          FOR EACH exp IN issue[exportKey]
            findings.push({ file: issueFile, line: exp.line ?? null, type: "unused-export", name: exp.name })

  RETURN findings
END FUNCTION
```

### Bug Condition (Metodología)

```pascal
FUNCTION isBugCondition(X)
  INPUT: X de tipo KnipJsonOutput
  OUTPUT: boolean

  // El bug se manifiesta cuando hay issues[] con dependencies/exports no vacíos
  RETURN X.issues IS array AND EXISTS issue IN X.issues WHERE
    (issue.dependencies.length > 0 OR issue.devDependencies.length > 0 OR
     issue.exports.length > 0 OR issue.types.length > 0)
END FUNCTION
```

```pascal
// Property: Fix Checking — dependencias detectadas
FOR ALL X WHERE isBugCondition(X) DO
  result ← parseKnipOutput'(JSON.stringify(X))
  ASSERT result contiene al menos un finding con type "unused-dependency" OR "unused-export"
END FOR
```

```pascal
// Property: Preservation Checking — files sigue funcionando
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT parseKnipOutput(X) = parseKnipOutput'(X)
END FOR
```

## Archivos Afectados

| Archivo | Cambio |
|---------|--------|
| `lambda/analyzer.ts` | Reescribir `parseKnipOutput` |
| `test/unit/analyzer.test.ts` | Agregar test con formato real de knip JSON |

## Compatibilidad

La función `mapKnipType` se mantiene sin cambios ya que sigue siendo útil para clasificar los tipos. Sin embargo, la lógica principal ya no depende de iterar claves del primer nivel sino de recorrer el array `issues[]`.
