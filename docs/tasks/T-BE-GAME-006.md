# T-BE-GAME-006 — Q3 power effects

**Status:** Not started
**Pair:** `wings_of_power_app/docs/game/tasks/T-GAME-006.md`
**Phase:** 1
**Depends on:** T-BE-GAME-005
**Plan:** `wings_of_power_app/docs/game/GAME_PLAN.md`

## Goal

After Q2, run five Q3 questions with the same buzz and steal rules as Q1. The buzz winner may use their hero’s `PowerCode` once. The server changes the deadline or the visible options and emits `power:effect`. Harmony returns `NO_TEAMMATE` when the team has one player.

## In scope

- Q3 intro and five pack questions. Same buzz, answer, steal, and ball rules as Q1.
- `power:use` `{ roundId, powerCode }` accepted only from the current answerer, only in Q3, only if `power_used` is false, only for that participant’s hero power.
- Effects, matching the plan table: Lab removes two wrong indexes, Checkmate removes one, Melody and Color add 10s to `deadlineAt`, Nature and Story send `meta_json.hint`, Prism sends weights that are not 100 on the correct option. Removed indexes are never the correct one.
- `power:effect` goes to the answerer. Opponents get a non-revealing notice that a power was used (`powerCode` only) so their waiting row can show a chip, without hint text or removed indexes.
- Set `GameParticipant.power_used`.
- Reject Q1/Q2/Q4 use, a second use, and a teammate’s power code.
- Bot does not use a power in this task.

## Out of scope

- `power:help_request` and `power:help_suggest` (T-BE-GAME-012).
- Awarding extra points for using a power.

## Allowed files

- `wings_of_power_backend/src/modules/game/**`
- `wings_of_power_backend/prisma/**` if `power_used` is missing
- `wings_of_power_backend/test/**`
- This task file

Seed heroes must cover Lab, Melody, Nature, and Harmony so the device script can be run by re-seeding Alex and Casey. Document the hero each seed student has in the seed file.

## Manual test (two simulators)

1. Automated: Lab effect lists two indexes, neither is the correct one, and the stored correct index is unchanged.
2. Automated: second `power:use` is rejected. Use outside Q3 is rejected. Harmony on a one-person team returns `NO_TEAMMATE` and does not set a hint.
3. Automated: Melody moves `deadlineAt` by 10s. A late answer inside the extra window still grades.
4. Automated: the opponent’s event payload has no hint and no removed indexes.
5. Device script from the app task.

## Done when

- The script passes.
- `yarn lint`, `yarn test`, `yarn test:e2e`, `yarn build` pass.
- Status and Notes updated.

## Notes

-
