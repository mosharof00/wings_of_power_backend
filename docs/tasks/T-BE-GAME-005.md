# T-BE-GAME-005 — Q2 free text and +50 kindness

**Status:** Not started
**Pair:** `wings_of_power_app/docs/game/tasks/T-GAME-005.md`
**Phase:** 1
**Depends on:** T-BE-GAME-004
**Plan:** `wings_of_power_app/docs/game/GAME_PLAN.md`

## Goal

Q2 is one free-text prompt with a 60s deadline. Every connected participant may submit. Non-empty text awards +50 kindness to that participant and one shootout ball. Empty or timeout awards 0. No “fewer points” value is invented (D23).

## In scope

- After Q1 round-complete, emit the Q2 intro and one `round:question` with the pack prompt, no options, `deadlineAt` 60s.
- `round:answer` `{ freeText }` once per participant. Whitespace-only is empty.
- When a player submits and others are still inside the window, emit `round:waiting`. Do not include anyone’s text in broadcasts.
- At the deadline, or when all connected participants have submitted, emit `round:answer_result` per submitter with `kindnessDelta` 50 or 0, and add 50 to that team’s `score_kindness` only for the 50 case.
- Grant one ball per non-empty submit, then the existing shootout flow, then `round:complete`.
- Store `GameAnswer.free_text`. Do not run a sentiment or keyword grader.
- Bot submits a fixed non-empty sentence at 5s and receives +50. That sentence can be the seed string “I would sit with Harold and tell them to stop.”

## Out of scope

- Teacher review of the text.
- PointsLedger final write (T-BE-GAME-008). In-match `score_kindness` is enough here.
- Pausing the 60s clock for one writer.

## Allowed files

- `wings_of_power_backend/src/modules/game/**`
- `wings_of_power_backend/prisma/**` if `free_text` is missing
- `wings_of_power_backend/test/**`
- This task file

## Manual test (two simulators)

1. Automated: two submits, both non-empty, yield kindness 50 each and two balls. One empty yields a single 50 and one ball.
2. Automated: a second submit from the same participant is ignored.
3. Automated: the other participant’s socket payload does not contain the free text.
4. Device script from the app task, both phones.
5. Bot match: bot kindness lands on the bot team only.

## Done when

- The script passes.
- `yarn lint`, `yarn test`, `yarn test:e2e`, `yarn build` pass.
- Status and Notes updated.

## Notes

-
