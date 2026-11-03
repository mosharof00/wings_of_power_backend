# T-BE-GAME-012 — Pass once, majority tally, Harmony suggest

**Status:** Done
**Pair:** `wings_of_power_app/docs/game/tasks/T-GAME-012.md`
**Phase:** 3
**Depends on:** T-BE-GAME-011
**Plan:** `wings_of_power_app/docs/game/GAME_PLAN.md`

## Goal

Server-side pass, Q4 majority for a team of five, and Harmony’s teammate suggestion. The suggestion is an option index with no key attached. Majority uses votes that arrived by 20 seconds (decision 8, D9, D20).

## In scope

- `round:pass` once per question, Q1 and Q3 only, from the current answerer, only if the team has another connected member. Transfer the answer right to one teammate (lowest seat index who is connected and is not the passer). Reset the answer `deadlineAt` to 10s from now. Emit `round:buzz_winner` for the new answerer and `round:waiting` for everyone else. A second pass is rejected.
- Q4 tally: count votes in before the deadline. Winner is the strict majority among submitted votes. Example: votes 2, 2, 1 is a tie on top and awards no ball. Votes 3, 1, 1 award the option with 3. Disconnected members are not in the denominator. Early resolve when all connected members of the buzzing team have voted.
- `power:help_request` from the Harmony answerer. Notify connected teammates with `power:help_request` echoed as a server event that contains the prompt and options and no correct index. Add that server event name to `docs/REALTIME.md` only if it is not already covered by `power:effect`; prefer `power:effect` with `effect: "help_request"`.
- `power:help_suggest` `{ roundId, forUserId, optionIndex }` from a teammate. Relay the index to the answerer. Reject opponents, the answerer suggesting to themself, and indexes outside the list. Do not grade the suggestion. The answerer still must `round:answer`.
- 1v1 pass and Harmony stay rejected.

## Out of scope

- Letting the teammate submit the graded answer directly.
- Multiple suggestions. First suggestion wins; later ones are rejected.

## Allowed files

- `docs/REALTIME.md` if the help event needs a line (edit first)
- `wings_of_power_backend/src/modules/game/**`
- `wings_of_power_backend/test/**`
- This task file

## Manual test (two simulators)

1. Automated with five sockets on one team: pass moves the answer right once; the original buzzer’s later `round:answer` is rejected; the teammate’s answer grades.
2. Automated votes `(A, A, B)` → A wins and `correct` follows the pack. Votes `(A, A, B, B)` → null, no ball. One vote and four silent teammates → that vote wins at 20s. All five voting early resolves before 20s.
3. Automated: opponent `power:help_suggest` is rejected. The relay payload has `optionIndex` and no correct index.
4. Device script from the app task with the ten-student queue.
5. A 1v1 socket pair still gets pass rejected.

## Done when

- The script passes.
- `yarn lint`, `yarn test`, `yarn test:e2e`, `yarn build` pass.
- Status and Notes updated.

## Notes

- Implemented `RoundService.pass` and `GameGateway.handlePass`: validates Q1/Q3 only, current answerer only, rejects in 1v1/single modes, enforces 1 pass per question, passes to lowest jersey_number among connected teammates, resets `deadlineAt` to +10s, emits `round:buzz_winner` to the match room and `round:waiting` with `TEAMMATE`/`OPPONENT` reasons, rejects original buzzer's later answer.
- Implemented `RoundService.recordVote`, `resolveVote`, and `GameGateway.resolveVoteAndAdvance`: strict majority calculation among submitted votes (`maxVotes > totalSubmitted / 2`), ties award null / no ball, disconnected members excluded from denominator, early resolve when all connected members of the voting team have voted.
- Implemented `RoundService.requestHelp` and `GameGateway.handleHelpRequest`: validates Q3 only, current answerer only, rejects 1v1, emits `power:help_request` with `{ roundId, prompt, options }` (no correct index) to connected teammates.
- Implemented `RoundService.suggestHelp` and `GameGateway.handleHelpSuggest`: validates teammate relationship (rejects opponents), rejects self-suggestion, rejects out-of-bounds options, enforces first suggestion wins (rejects later ones), relays `{ roundId, fromUserId, optionIndex }` to answerer without key.
- Verified validation:
  - `ESLINT_USE_FLAT_CONFIG=false npx eslint src/modules/game test` passed cleanly with 0 errors.
  - `yarn test src/modules/game/` passed (78/78 tests).
  - `yarn test:e2e test/game.e2e-spec.ts` passed (12/12 tests).
  - `yarn build` passed cleanly.
