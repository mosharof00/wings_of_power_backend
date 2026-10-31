# T-BE-GAME-011 — 5v5 queue, random 5/5, no short starts

**Status:** Not started
**Pair:** `wings_of_power_app/docs/game/tasks/T-GAME-011.md`
**Phase:** 3
**Depends on:** T-BE-GAME-010
**Plan:** `wings_of_power_app/docs/game/GAME_PLAN.md`

## Goal

`FIVE_V_FIVE` starts only at 10 eligible students, then assigns them at random to two teams of five (D3, D21). Partial counts, including odd ones, stay queued. No bots.

## In scope

- Queue required count 10. `queue:update.required` is 10.
- Shared copy hint in `queue:update`: add `partial: true` and `others` (filled - 1) to `docs/REALTIME.md` before coding so the client can show “Only {others} classmates were found”.
- At 10, shuffle, split 5/5, persist teams, emit `match:found`. Same `match:start` and 20s auto-start as 1v1.
- Counts 1 through 9 never create a `GameMatch`.
- Dev-only script `yarn game:queue-fixtures --mode FIVE_V_FIVE --count N` logs in seeded fixture students and joins the queue. It refuses to run unless `GAME_FIXTURES=1`. It uses real JWTs and `is_bot: false`. Document the seed users (ten eligible students) in the seed file.
- The match engine from phase 1 runs with team size 5. Buzz winner still blocks the rest of the match from answering. Teammate waiting reasons must say `TEAMMATE` when the waiter shares a team (REALTIME `round:waiting`).

## Out of scope

- Pass and Harmony behavior beyond emitting `TEAMMATE` vs `OPPONENT`. T-BE-GAME-012 owns pass and votes.
- Teacher team balancing.

## Allowed files

- `docs/REALTIME.md` (the `queue:update` fields, first)
- `wings_of_power_backend/src/modules/game/**`
- `wings_of_power_backend/package.json` (one script entry)
- `wings_of_power_backend/prisma/seed.ts` (extra eligible students)
- `wings_of_power_backend/test/**`
- This task file

## Manual test (two simulators)

1. Automated: queues of 3, 4, 7, and 9 create zero matches. A queue of 10 creates one match, two teams, five each, every user on exactly one team. Two runs may differ in membership; both must be 5/5. No `is_bot` seats.
2. Automated: the 10th join emits one `match:found` to all ten sockets.
3. Device script from the app task using the yarn command for the extra seats.
4. Ineligible Blake in the fixture list is skipped and does not count toward 10.
5. After start, a snapshot for Alex and Casey shows the same teams.

## Done when

- The script passes.
- `yarn lint`, `yarn test`, `yarn test:e2e`, `yarn build` pass.
- Status and Notes updated.

## Notes

-
