# T-BE-GAME-003 — Countdown and Q1 referee

**Status:** Not started
**Pair:** `wings_of_power_app/docs/game/tasks/T-GAME-003.md`
**Phase:** 1
**Depends on:** T-BE-GAME-002
**Plan:** `wings_of_power_app/docs/game/GAME_PLAN.md`

## Goal

The server runs countdown and the Q1 question loop for a practice match. First legal buzz wins. Timeouts and steals follow D20. Payloads omit the correct index until the result event, and the result event still does not include it for the opposing team’s future use — `correct` is a boolean on `round:answer_result` after the attempt.

## In scope

- After `match:found`, start countdown (`match:countdown`, 3s, `deadlineAt`). Then `round:intro` for Q1.
- Intro ack: add `round:intro_ack` `{ roundType }` to `docs/REALTIME.md` before coding, or skip the new event and only use the 15s auto-advance from D20. Pick the auto-advance. Clients may also send `round:intro_ack`; if you add it, document it first.
- For each of the five Q1 questions: `round:question` with prompt, options (text only), index, total, `deadlineAt` for the buzz window. No correct index.
- `round:buzz`: ignore late, duplicate, disconnected, or non-participant buzzes. First accepted buzz emits `round:buzz_winner` and `round:waiting` to the others. Open a 10s answer deadline.
- `round:answer`: accept only from the buzz winner (or the player who was passed to, later). One answer. Grade on the server. Emit `round:answer_result` with `correct`, updated scores (zeros until T-BE-GAME-004), and no option key.
- Wrong or answer-timeout: 10s steal window for the other team only, one buzz. Then the same answer rules. Second failure advances.
- Buzz timeout with no buzz: advance.
- Bot (D22): if nobody has buzzed at 7s, the bot buzzes; 2s later it submits the correct option. On a human wrong answer the bot steals at 3s and answers correctly.
- Persist `GameRound` and `GameAnswer`. In-memory timers cancel when the phase advances.
- Questions come from the seeded pack. Do not hardcode the prompt in the service if the pack row exists.

## Out of scope

- XP, kindness ledger, shootout swipe, powers, public matchmaking.
- Letting the client send `correct: true`.

## Allowed files

- `docs/REALTIME.md` only if a new event is required (write it first)
- `wings_of_power_backend/src/modules/game/**`
- `wings_of_power_backend/prisma/**` if a column for round phase is still missing
- `wings_of_power_backend/test/**`
- This task file

## Manual test (two simulators)

1. Automated: two sockets buzz 20ms apart; only the first `round:buzz_winner` is emitted. A buzz after `deadlineAt` is ignored. The loser cannot `round:answer`.
2. Automated: wrong answer opens one steal; the buzzing team cannot steal its own miss; a second wrong ends the question.
3. Automated: bot fixture (one human socket that never buzzes) still finishes question 1 with `correct: true` for the bot after the 7s + 2s delays. Use fake timers.
4. On device: Alex and Casey’s phones stay in lockstep through question 1, including a steal, as in the app task script.
5. Inspect a `round:question` frame. It has no correct index.

## Done when

- The script passes.
- `yarn lint`, `yarn test`, `yarn test:e2e`, `yarn build` pass.
- Status and Notes updated.

## Notes

-
