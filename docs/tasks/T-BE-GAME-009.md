# T-BE-GAME-009 — Public 1v1 queue

**Status:** Not started
**Pair:** `wings_of_power_app/docs/game/tasks/T-GAME-009.md`
**Phase:** 2
**Depends on:** T-BE-GAME-008
**Plan:** `wings_of_power_app/docs/game/GAME_PLAN.md`

## Goal

`ONE_V_ONE` matches two eligible students who are waiting. It never starts at one player and never inserts a bot (D21). A full room waits for Start Game, then falls through to the same match engine as practice.

## In scope

- In-memory queue per mode. `POST /api/game/queue` `{ mode: "ONE_V_ONE" }` or `queue:join`.
- `queue:update` `{ mode, filled, required: 2, players }` to each waiter. Players include nickname and avatar, not hero art.
- On the second player: create `GameMatch` mode `ONE_V_ONE`, two teams of one, emit `match:found`, and keep phase at matched until start. Do not countdown yet.
- Add `match:start` `{ matchId }` to `docs/REALTIME.md` before coding. Any seated human may send it. First valid one starts countdown for both. If nobody sends it within 20s of `match:found`, the server starts (D20).
- `DELETE /api/game/queue` and `queue:cancel` before start return the other player to `filled: 1`. Cancel after start is leave, owned by T-BE-GAME-010; reject it here with a clear code if leave is not implemented yet.
- Ticket older than 10 minutes is dropped and the client gets `queue:error` or a `queue:update` with `expired: true`. Document the field in REALTIME.md if you add it.
- Ineligible and already-queued errors as in REALTIME.md.
- Two humans then play Q1–Q4 with the bot hooks idle (no bot seat).

## Out of scope

- 5v5.
- Class, age, or school filters (D3).
- `fixtureCode` changes. That path stays on `SINGLE`.

## Allowed files

- `docs/REALTIME.md` (document `match:start` and any expiry field first)
- `wings_of_power_backend/src/modules/game/**`
- `wings_of_power_backend/prisma/**` for `MatchmakingTicket` only if you persist it; memory is enough for MVP
- `wings_of_power_backend/test/**`
- This task file

## Manual test (two simulators)

1. Automated: one ticket does not create a match. The second ticket creates one match with two humans and zero bots. A third ticket stays queued at filled 1.
2. Automated: cancel before start dissolves the pair and leaves the remaining student queued.
3. Automated: `match:start` from a non-participant is ignored. The 20s timer starts countdown once.
4. Device script from the app task, including Blake’s rejection.
5. Restart the Nest process. In-memory tickets are gone (acceptable). A persisted `PLAYING` match from before the restart is not required to resume in this task; do not corrupt it into a second live loop. If it is still `PLAYING`, leave it for the reconnect task.

## Done when

- The script passes.
- `yarn lint`, `yarn test`, `yarn test:e2e`, `yarn build` pass.
- Status and Notes updated.

## Notes

-
