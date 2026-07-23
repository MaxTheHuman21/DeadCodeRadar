# Documento de Requisitos del Bugfix

## Introducción

La función `parseKnipOutput` en `lambda/analyzer.ts` no parsea correctamente el formato real de salida JSON de `knip --reporter json`. Las dependencias (tipo "unused-dependency"), exports y otros hallazgos anidados dentro de `issues[]` nunca se emiten como findings porque la lógica de parseo itera las claves de primer nivel del JSON, pero en el formato real de knip estos datos están anidados dentro de `parsed.issues[].dependencies`, `parsed.issues[].exports`, etc.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN knip produce un JSON con dependencias no usadas dentro de `issues[0].dependencies` THEN el sistema no emite ningún finding de tipo "unused-dependency" porque itera claves de primer nivel y no encuentra una clave `dependencies` a ese nivel.

1.2 WHEN knip produce un JSON con exports no usados dentro de `issues[].exports` THEN el sistema no emite ningún finding de tipo "unused-export" para esos exports porque busca `parsed.exports` (primer nivel) que no existe en el formato real.

1.3 WHEN knip produce un JSON con `devDependencies`, `unlisted`, `binaries`, u `optionalPeerDependencies` dentro de `issues[]` THEN el sistema ignora todos esos hallazgos.

1.4 WHEN knip produce un JSON con tipos no usados dentro de `issues[].types` THEN el sistema no emite findings de tipo "unused-export" para esos tipos.

### Expected Behavior (Correct)

2.1 WHEN knip produce un JSON con dependencias no usadas dentro de `issues[].dependencies` THEN el sistema SHALL emitir un finding con `type: "unused-dependency"`, `file: "package.json"`, y `name` igual al nombre de la dependencia para cada entrada.

2.2 WHEN knip produce un JSON con exports no usados dentro de `issues[].exports` THEN el sistema SHALL emitir un finding con `type: "unused-export"`, `file` igual al campo `file` del issue padre, `name` igual al nombre del export, y `line` igual a la línea reportada.

2.3 WHEN knip produce un JSON con `devDependencies`, `unlisted`, `binaries`, u `optionalPeerDependencies` dentro de `issues[]` THEN el sistema SHALL emitir findings de tipo "unused-dependency" con `file: "package.json"` y el nombre correspondiente.

2.4 WHEN knip produce un JSON con tipos no usados dentro de `issues[].types` THEN el sistema SHALL emitir findings de tipo "unused-export" con el archivo del issue padre, el nombre del tipo, y la línea reportada.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN knip produce un JSON con `files` como array de strings en primer nivel THEN el sistema SHALL CONTINUE TO emitir findings de tipo "unused-file" con el nombre base del archivo.

3.2 WHEN knip falla y se usa ts-prune como fallback THEN el sistema SHALL CONTINUE TO parsear la salida de texto de ts-prune y emitir findings de tipo "unused-export".

3.3 WHEN knip excede el timeout THEN el sistema SHALL CONTINUE TO lanzar AppError con tipo ANALYSIS_TIMEOUT y caer al fallback ts-prune.

3.4 WHEN ambos motores fallan THEN el sistema SHALL CONTINUE TO lanzar AppError con tipo ANALYSIS_ENGINE_FAILED.
