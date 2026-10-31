# T-BE-GAME-007 — Q4 vote, 20 seconds, majority of one

**Status:** Not started
**Pair:** `wings_of_power_app/docs/game/tasks/T-GAME-007.md`
**Phase:** 1
**Depends on:** T-BE-GAME-006
**Plan:** `wings_of_power_app/docs/game/GAME_PLAN.md`

## Goal

Three Q4 questions. Buzz to select the team. That team has 20 seconds (D9). Majority of submitted votes is the team answer. A one-person team resolves as soon as that vote arrives. Tie or no votes: no ball.

## In scope

- Q4 intro and three pack questions. Buzz rules match Q1. Do not open options for the whole match on buzz; open the vote for the buzzing team only.
- `round:vote` `{ roundId, optionIndex }` once per connected member of that team, before `deadlineAt`.
- `round:vote_update` `{ submittedCount, teamSize }` to the match. No option indexes in that event.
- Resolve when every connected member has voted, or at 20s. Majority is the option with the most votes. Tie: no winner, `winningOptionIndex` null, no ball. Emit `round:vote_result` `{ winningOptionIndex, tallies, correct }`. Tallies are counts, and they are allowed only on this result event.
- A correct majority grants one ball to the buzzing participant (the person who won the buzz), then the shootout flow. Q4 shootouts use the same `shootout:*` events. XP and +3 Vs rules do not change.
- Buzz timeout: next question, no vote.
- Bot: same 7s buzz and, if the bot’s team is voting, a correct vote at +2s.

## Out of scope

- Teams larger than one. The code path must accept `teamSize > 1` without a special case that would break phase 3, but this task does not need a 5v5 test.
- Pass during Q4. Reject `round:pass` on Q4.

## Allowed files

- `wings_of_power_backend/src/modules/game/**`
- `wings_of_power_backend/prisma/**` if vote columns are missing
- `wings_of_power_backend/test/**`
- This task file

## Manual test (two simulators)

1. Automated: one vote on a one-person team resolves immediately and does not wait 20s. `correct` follows the pack key.
2. Automated: zero votes at 20s yields `winningOptionIndex` null and no ball.
3. Automated: a vote from the other team is rejected. A second vote from the same person is rejected.
4. Automated: `round:vote_update` JSON has no `optionIndex`.
5. Device script from the app task. Both phones show the same chosen letter.

## Done when

- The script passes.
- `yarn lint`, `yarn test`, `yarn test:e2e`, `yarn build` pass.
- Status and Notes updated.

## Notes

-
