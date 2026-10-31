# T-BE-GAME-004 — Balls, shootout, team XP

**Status:** Not started
**Pair:** `wings_of_power_app/docs/game/tasks/T-GAME-004.md`
**Phase:** 1
**Depends on:** T-BE-GAME-003
**Plan:** `wings_of_power_app/docs/game/GAME_PLAN.md`

## Goal

A correct Q1 answer (or a successful steal) grants one shootout ball to that participant’s team shooter. The server records the swipe, awards +2 XP on a make and +0 on a miss, and adds 3 to the team Vs score per make (D23).

## In scope

- `shootout:start` `{ roundId, shooterParticipantId, deadlineAt }` with a 60s deadline. One event per ball, in seat order, after the question loop.
- `shootout:swipe` `{ roundId, made }` accepted only from that shooter before `deadlineAt`. Emit `shootout:result` `{ made, xp, teamScores }`. Persist `GameShootout`.
- Timeout emits a miss.
- Team `score_xp` display value used by the Vs pills is `score_baskets * 3`. `score_baskets` increments on a make. XP total is `score_baskets * 2`. Send both on results so the client does not multiply.
- Bot shootouts are `made: true` immediately when the bot is the shooter.
- `round:complete` after that quarter’s shootouts, with both teams’ scores. `Play Next Round` is `round:advance` — add it to `docs/REALTIME.md` before coding (`C→S` `{ matchId }`). Any participant may send it; the first one advances everyone. Auto-advance 15s after `round:complete` if nobody taps (same idea as D20 intro).
- Wrong participant, second swipe, and swipe after timeout do not change scores.

## Out of scope

- Kindness ledger. `score_kindness` stays 0.
- Q2 and Q4 content.
- Replacing client-reported `made` with physics.

## Allowed files

- `docs/REALTIME.md` (add `round:advance` first)
- `wings_of_power_backend/src/modules/game/**`
- `wings_of_power_backend/prisma/**` for `GameShootout` if it is not in the schema yet
- `wings_of_power_backend/test/**`
- This task file

## Manual test (two simulators)

1. Automated: a correct answer creates one ball; a wrong answer with a failed steal creates zero; a steal creates one for the stealing team.
2. Automated: the non-shooter swipe is ignored. Two swipes count once. A swipe 1s after `deadlineAt` is a stored miss only if the timeout job has not already written one — never two rows that both award XP.
3. Automated: one make yields team Vs 3 and XP 2. One miss yields Vs unchanged and XP 0.
4. Device script from the app task: both phones show the same `teamScores` after Alex’s make.
5. Bot match: bot make increments the bot team only.

## Done when

- The script passes.
- `yarn lint`, `yarn test`, `yarn test:e2e`, `yarn build` pass.
- Status and Notes updated.

## Notes

-
