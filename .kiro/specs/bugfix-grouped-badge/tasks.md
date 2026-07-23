# Implementation Plan

## Overview

Plan de corrección para el bug de propagación de `groupId` en el enricher. Los findings en la partición `remaining` (>50) pierden su `groupId`, rompiendo la agrupación y el badge "Grouped with N related finding(s)" en el frontend.

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - GroupId Perdido en Remaining
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Create 55 findings sorted alphabetically, craft a Bedrock response that assigns `groupId: "abcd1234"` to finding at index 48 (in selected). Finding 51+ shares the same `file` as finding 48 (falls in remaining). After `enrichFindings` completes, assert that the remaining finding also has `groupId: "abcd1234"`.
  - **Test file**: `test/unit/enricher-groupid-bug.test.ts`
  - Use `fast-check` to generate variations: number of findings (51-100), position of the grouped finding in selected (0-49), and verify propagation to remaining findings sharing the same file
  - Mock `invokeBedrockWithTimeout` to return controlled JSON with known groupIds
  - Mock `buildFileContext` to avoid filesystem access
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (proves the bug exists — remaining findings get `groupId: null`)
  - Document counterexamples found: e.g., "finding at position 52 with file 'test/classnames.js' got groupId: null instead of 'abcd1234'"
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Findings Sin Grupo Preservan groupId Null
  - **IMPORTANT**: Follow observation-first methodology
  - **Test file**: `test/unit/enricher-groupid-preservation.test.ts`
  - Observe: With ≤50 findings and no groupIds from Bedrock, all findings get `groupId: null` on unfixed code
  - Observe: With >50 findings where no group crosses the selected/remaining boundary, remaining findings get `groupId: null` on unfixed code
  - Observe: With Bedrock failure (fallback), all findings get `groupId: null`
  - Write property-based test with `fast-check`:
    - Generate arrays of 1-50 findings (no remaining) with Bedrock response having all `groupId: null` → assert all output findings have `groupId: null`
    - Generate arrays of 51-100 findings where Bedrock only assigns groupIds to findings whose file does NOT appear in remaining → assert remaining findings have `groupId: null`
  - Mock `invokeBedrockWithTimeout` and `buildFileContext`
  - Verify tests PASS on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.5_

- [x] 3. Fix: Propagar groupId a findings en remaining

  - [x] 3.1 Implement `buildGroupIdFileMap` helper function
    - Create new exported function in `lambda/enricher.ts`
    - Accepts `EnrichedFinding[]`, returns `Map<string, string>` mapping `file → groupId`
    - Only maps findings with non-null groupId
    - Handle edge case: if same file has multiple different groupIds, use the first one found (or the most common)
    - _Bug_Condition: isBugCondition(input) where remaining findings share file with grouped selected findings_
    - _Expected_Behavior: Map correctly reflects all file→groupId relationships from Bedrock_
    - _Requirements: 2.1_

  - [x] 3.2 Modify step 6 of `enrichFindings` to propagate groupId
    - Replace the unconditional `groupId: null` in the `remaining.map(...)` with lookup from `buildGroupIdFileMap`
    - Use `groupIdMap.get(f.file) ?? null` for each remaining finding
    - Ensure the change is minimal and targeted — only the groupId assignment changes
    - _Bug_Condition: remaining.map always assigns groupId: null_
    - _Expected_Behavior: remaining findings sharing file with grouped selected findings get the same groupId_
    - _Preservation: findings whose file is NOT in the groupId map still get null_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2_

  - [x] 3.3 Add intra-selected groupId propagation in `parseBedrockResponse`
    - After mapping enrichments to findings, add post-processing step
    - Build `fileToGroupId` map from enriched findings with non-null groupId
    - For findings omitted by Bedrock (got null fields): if their file matches a grouped file, assign that groupId
    - This handles the secondary bug case where Bedrock omits a finding from its response
    - _Bug_Condition: Bedrock omits a finding index from response, that finding shares file with grouped finding_
    - _Expected_Behavior: Omitted finding inherits groupId from its file-mate_
    - _Preservation: Findings whose file has no groupId in the map remain null_
    - _Requirements: 2.1, 2.2_

  - [x] 3.4 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - GroupId Propagado Correctamente
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run: `npx vitest --run test/unit/enricher-groupid-bug.test.ts`
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Findings Sin Grupo Siguen Sin Badge
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run: `npx vitest --run test/unit/enricher-groupid-preservation.test.ts`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint - Ensure all tests pass
  - Run full test suite: `npx vitest --run`
  - Verify existing `test/unit/enricher.test.ts` still passes (parseBedrockResponse regression)
  - Verify new bug condition test passes
  - Verify new preservation tests pass
  - Ensure no TypeScript compilation errors: `npx tsc --noEmit`
  - Ask the user if questions arise

## Notes

- Los tests de exploración (task 1) y preservación (task 2) DEBEN escribirse y ejecutarse ANTES de implementar la corrección
- El test de exploración debe FALLAR en código sin corregir (confirma que el bug existe)
- Los tests de preservación deben PASAR en código sin corregir (confirma el baseline)
- Después de la corrección, ambos tipos de test deben PASAR
- Se usa `fast-check` para property-based testing
- Se mockean `invokeBedrockWithTimeout` y `buildFileContext` para aislar la lógica de propagación

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3"] },
    { "id": 3, "tasks": ["3.4"] },
    { "id": 4, "tasks": ["3.5"] },
    { "id": 5, "tasks": ["4"] }
  ]
}
```
