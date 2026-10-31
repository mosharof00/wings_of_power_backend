# T-BE-GAME-002 — Practice match, bot seat, socket snapshot

**Status:** Not started
**Pair:** `wings_of_power_app/docs/game/tasks/T-GAME-002.md`
**Phase:** 1
**Depends on:** T-BE-GAME-001
**Plan:** `wings_of_power_app/docs/game/GAME_PLAN.md`

## Goal

`POST /api/game/queue` with `SINGLE` creates a match the student can reconnect to. Two students who share a `fixtureCode` share one match. Everyone else in practice gets a bot opponent. The socket is authenticated and the snapshot has no answer key.

## In scope

- Before coding, update `docs/DATABASE.md`: `GameParticipant.user_id` optional, add `is_bot Boolean`. Update `docs/API.md`: `POST /api/game/queue` accepts optional `fixtureCode`, honored only when `GAME_FIXTURES=1`. Update `docs/REALTIME.md` only if the snapshot example needs `isBot` on members. Then migrate.
- Tables this task may add from DATABASE.md: `Hero`, `StudentHeroUnlock`, `GameQuestionPack`, `GamePackQuestion`, `GameMatch`, `GameTeam`, `GameParticipant`, `GameRound`. Seed the seven named heroes and the fixture pack from the plan. First hero unlocked; the others locked until two stories, matching the hero-detail rule already in DATABASE.md.
- `GET /api/heroes`, `POST /api/heroes/:id/select`. Reject a locked hero.
- `GameGateway` on the default namespace. Reject a missing or bad JWT. Join `user:{userId}`.
- `POST /api/game/queue` `{ mode: "SINGLE" }`: if `GAME_FIXTURES=1` and `fixtureCode` matches a waiting ticket, seat both humans (teams of one) and emit `match:found`. Otherwise create a match with the human and one bot and emit `match:found`.
- `DELETE /api/game/queue` cancels a ticket that has not matched.
- Ineligible students receive `queue:error` `INELIGIBLE` and no match.
- Persist the match at create. In-memory state is the live copy. On socket connect, if the user has an open participant, join `match:{id}` and emit `match:snapshot` as in REALTIME.md. Omit correct indexes.
- Bot timing is not started here beyond creating the seat. Questions start in T-BE-GAME-003.
- `GET /api/game/matches/:id` returns the same snapshot for the participant. A different user gets 403.

## Out of scope

- Question loop, scoring, public `ONE_V_ONE` / `FIVE_V_FIVE` matching.
- Chat gateway edits.
- Naming an eighth hero.

## Allowed files

- `docs/DATABASE.md`, `docs/API.md`, `docs/REALTIME.md` (the edits named above, first)
- `wings_of_power_backend/src/modules/game/**`
- `wings_of_power_backend/prisma/schema.prisma`
- `wings_of_power_backend/prisma/migrations/**` (this migration)
- Seed file already used by T-BE-GAME-001
- `wings_of_power_backend/test/**` for this module
- This task file

## Manual test (two simulators)

1. Unit/e2e: ineligible queue does not create a `GameMatch`. Locked hero select returns 4xx.
2. Alex queues `SINGLE` with no code. One match, one human, one bot. Snapshot JSON has no `correctIndex` and no `options_json` answer key.
3. Alex and Casey queue `SINGLE` with `fixtureCode: "desk-1"` while `GAME_FIXTURES=1`. Both receive the same `matchId`. A third queue with that code does not join the live match; it gets its own bot match.
4. With `GAME_FIXTURES` unset, `fixtureCode` is ignored and each student gets a bot.
5. Reconnect Alex’s socket. The server emits one snapshot for the open match, not a second match.
6. Casey requests Alex’s match id over REST and is rejected.

## Done when

- The script passes.
- `yarn lint`, `yarn test`, `yarn test:e2e`, `yarn build` pass.
- Status and Notes updated.

## Notes

-
