# T-BE-GAME-010 — Disconnect grace, leave, forfeit

**Status:** Not started
**Pair:** `wings_of_power_app/docs/game/tasks/T-GAME-010.md`
**Phase:** 2
**Depends on:** T-BE-GAME-009
**Plan:** `wings_of_power_app/docs/game/GAME_PLAN.md`

## Goal

Implement D19. Leave is immediate. A socket drop waits 15 seconds. Timers never pause. Reconnect sends `match:snapshot`. Missed deadlines reject submits. A 1v1 that is alone for 60 seconds of `PLAYING` forfeits to the connected human.

## In scope

- `match:leave` and `POST /api/game/matches/:id/leave` set `left_at`, emit `match:peer_left` `{ userId, nickname }`, and keep the phase. The leaver is removed from buzz and vote eligibility.
- Gateway disconnect starts a 15s timer. Reconnect before it clears the timer, sets `is_connected`, rejoins `match:{id}`, emits `match:snapshot` with `serverNow` and `deadlineAt`. No `match:peer_left` for a blip.
- After grace, `is_connected` false and `match:peer_left` fires. The player may still reconnect inside the 2-hour TTL. Submits for a round whose `deadlineAt` is past return an error and do not change `GameAnswer`.
- If the disconnected side is the buzz winner when the deadline fires, grade a miss and continue (steal rules still apply to the connected side).
- 1v1: if one human is left or past grace and the other has been the only connected human for 60s of `PLAYING`, emit `match:finished` with that human’s team as winner. Do not delete ledger rows already written at the end; write the finish ledger now if Q2 kindness was already on the team scores, using the same once-only insert as T-BE-GAME-008.
- Both humans gone for 60s → `phase: CANCELLED`, no winner, no new kindness.
- Practice bot seats do not start the grace timer. Human leave in `SINGLE` finishes the match with `winnerTeamId` null.
- On process boot, matches still `PLAYING` may be marked `CANCELLED` (REALTIME.md). Do that in this task.

## Out of scope

- 5v5 forfeit of a whole side (the same “all members gone” rule should already work if every member is checked; add a test when T-BE-GAME-011 exists, not a second implementation).
- Pausing `deadlineAt` during grace.

## Allowed files

- `wings_of_power_backend/src/modules/game/**`
- `wings_of_power_backend/prisma/**` if `is_connected` / `left_at` are missing
- `wings_of_power_backend/test/**`
- This task file

## Manual test (two simulators)

1. Automated with fake timers: disconnect at t=0, reconnect at t=10s, no peer-left, snapshot phase unchanged, deadline unchanged.
2. Automated: disconnect past 15s emits peer-left once. A submit after `deadlineAt` does not insert a correct answer.
3. Automated: 1v1, opponent past grace, 60s later `match:finished` names the remaining team. A second finish call does not double the ledger.
4. Automated: both disconnected 60s → `CANCELLED`.
5. Device script from the app task.

## Done when

- The script passes.
- `yarn lint`, `yarn test`, `yarn test:e2e`, `yarn build` pass.
- Status and Notes updated.

## Notes

-
