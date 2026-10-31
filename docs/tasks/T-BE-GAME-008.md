# T-BE-GAME-008 — Finish the match and write kindness

**Status:** Not started
**Pair:** `wings_of_power_app/docs/game/tasks/T-GAME-008.md`
**Phase:** 1
**Depends on:** T-BE-GAME-007
**Plan:** `wings_of_power_app/docs/game/GAME_PLAN.md`

## Goal

After Q4 round-complete, emit `match:finished`, set the winner from the Vs score, and write one `PointsLedger` kindness row per human who earned Q2 kindness. The leaderboard endpoint sums those rows.

## In scope

- Winner is the team with the higher Vs score (`baskets * 3`). If the Vs scores tie, compare `score_kindness`. If those also tie, `winnerTeamId` is null (D23). Do not flip a coin.
- Persist `phase: FINISHED`, `finished_at`, `winner_team_id`.
- `match:finished` `{ matchId, winnerTeamId, scores, kindness }` as in REALTIME.md. `kindness` is per participant: user id, nickname, avatar, amount. Bots are in `scores` and omitted from the ledger.
- `PointsLedger` from DATABASE.md: `kindness_amount` 50, `amount` 50, `source` a game value, `ref_type` `GameMatch`, `ref_id` the match. One row per awarding. Re-reading finish must not insert a second row.
- `GET /api/student/leaderboard?scope=school` returns nickname, avatar, kindness sum. No hero name. `scope=class` may return the same list until classes exist; document that in Notes. Add the route to `docs/API.md` only if the query name differs — the path is already specified.
- Add `PointsLedger` and a `PointsSource` value if missing. Do not store this in template `User.points`.

## Out of scope

- Teacher award rows.
- Badge grants.
- Admin match history routes.

## Allowed files

- `docs/DATABASE.md` only to note the game `PointsSource` value if it is not already there (edit before the migration)
- `wings_of_power_backend/src/modules/game/**`
- `wings_of_power_backend/src/modules/` student leaderboard controller if you place it next to an existing student module; otherwise keep it inside `src/modules/game/` and say so in Notes
- `wings_of_power_backend/prisma/**`
- `wings_of_power_backend/test/**`
- This task file

## Manual test (two simulators)

1. Automated: higher basket count wins even if the other team has more kindness. Equal baskets and equal kindness yield null. Equal baskets and higher kindness wins.
2. Automated: finish twice (replay the handler) inserts one ledger row.
3. Automated: bot kindness is not a ledger row. Human +50 is.
4. Device: both phones receive the same `winnerTeamId`. Leaderboard on each phone shows Alex’s sum increased by the match and not by a second visit.
5. A student who was not in the match gets 403 on `GET /api/game/matches/:id` and a leaderboard list that does not include private answers.

## Done when

- The script passes.
- `yarn lint`, `yarn test`, `yarn test:e2e`, `yarn build` pass.
- Status and Notes updated.

## Notes

-
