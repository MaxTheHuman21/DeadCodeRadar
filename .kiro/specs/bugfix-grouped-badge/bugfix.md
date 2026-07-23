# Documento de Requisitos del Bugfix

## Introducción

Cuando el backend (enricher) procesa más de 50 findings, divide la lista en `selected` (los primeros 50, que se envían a Bedrock para enriquecimiento) y `remaining` (el resto). Los findings en `remaining` reciben `groupId: null` de forma incondicional, lo que rompe la agrupación: si dos findings comparten el mismo `groupId` asignado por Bedrock pero uno cae en `selected` y el otro en `remaining`, el frontend solo ve un miembro del grupo con `groupId` válido, y por tanto ese finding no cumple la condición `groupSize > 1` para mostrar el badge "Grouped with N related finding(s)".

Además, en el frontend, la función `countGroups` solo opera sobre los findings que efectivamente llegan con `groupId` no nulo. El resultado es que, para el caso reportado, `test/classnames.js` y `test/index.js` comparten `groupId "i9j0k1l2"` en la respuesta de Bedrock, pero si uno de ellos cae fuera de los primeros 50 findings seleccionados, pierde su `groupId` y el badge solo aparece en el que sí fue enriquecido.

**Impacto**: El usuario ve información inconsistente — un finding muestra el badge de agrupación pero su compañero de grupo no lo muestra, generando confusión sobre la relación entre hallazgos.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN dos o más findings comparten el mismo `groupId` asignado por Bedrock PERO uno de ellos cae en la partición `remaining` (más allá de los primeros 50 findings seleccionados para enriquecimiento) THEN el sistema asigna `groupId: null` al finding en `remaining`, rompiendo la agrupación

1.2 WHEN un finding tiene `groupId: null` debido al manejo de `remaining` en el enricher THEN el frontend no lo cuenta como miembro de ningún grupo, y su compañero de grupo muestra `groupSize = 1` (badge no visible) o un conteo incorrecto

1.3 WHEN el badge "Grouped with N related finding(s)" se muestra para un finding del grupo THEN el conteo "N" no refleja el total real de miembros del grupo porque los findings en `remaining` fueron despojados de su `groupId`

### Expected Behavior (Correct)

2.1 WHEN dos o más findings comparten el mismo `groupId` asignado por Bedrock y alguno de ellos cae en la partición `remaining` THEN el sistema SHALL propagar el `groupId` a todos los miembros del grupo, incluyendo los findings en `remaining`

2.2 WHEN cualquier finding tiene un `groupId` que coincide con al menos otro finding en el array completo de resultados THEN el frontend SHALL mostrar el badge "Grouped with N related finding(s)" en TODOS los findings del grupo, no solo en uno

2.3 WHEN el badge de agrupación se muestra THEN el conteo "N" SHALL reflejar el número real de otros miembros del grupo (total del grupo menos 1), considerando todos los findings del array completo

### Unchanged Behavior (Regression Prevention)

3.1 WHEN un finding tiene `groupId: null` (no pertenece a ningún grupo) THEN el sistema SHALL CONTINUE TO no mostrar el badge de agrupación para ese finding

3.2 WHEN todos los findings de un grupo están dentro de los primeros 50 seleccionados para enriquecimiento THEN el sistema SHALL CONTINUE TO mostrar correctamente el badge y conteo para todos ellos (caso que ya funciona)

3.3 WHEN el enricher falla y aplica fallback THEN el sistema SHALL CONTINUE TO asignar `groupId: null` a todos los findings y no mostrar badges de agrupación

3.4 WHEN los findings se ordenan por confianza en el frontend THEN el sistema SHALL CONTINUE TO mostrar el orden correcto independientemente de la pertenencia a un grupo

3.5 WHEN un finding pertenece a un grupo pero es el único miembro con ese `groupId` (grupo de tamaño 1) THEN el sistema SHALL CONTINUE TO no mostrar el badge de agrupación
