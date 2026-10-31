# T-BE-GAME-013 — Jersey numbers and intro order

**Status:** Not started
**Pair:** `wings_of_power_app/docs/game/tasks/T-GAME-013.md`
**Phase:** 3
**Depends on:** T-BE-GAME-011
**Plan:** `wings_of_power_app/docs/game/GAME_PLAN.md`

## Goal

Assign a jersey number when a match is seated, and emit one intro sequence before countdown. Decision 10: introduce each player and their number. Nothing else.

## In scope

- Before coding, add `jerseyNumber` on match members and a `match:intro` event to `docs/REALTIME.md`: `{ matchId, order: [{ userId, nickname, jerseyNumber }], deadlineAt }`. `deadlineAt` covers the whole sequence (about 2 seconds per human). Then countdown starts. `match:start` leads with intro, then the existing countdown.
- Numbers are unique per match. 1v1 uses 1 and 2. 5v5 uses 1…10. Assign after the random split, in seat order, so both sides of the socket see the same map. Include the bot’s number only if the bot is a `match:found` member; use nickname “Teammate” for the bot and do not put the bot on the leaderboard.
- Persist the number on `GameParticipant` (add the column through `docs/DATABASE.md` first).
- Reconnect snapshot includes `jerseyNumber` and, if the intro deadline is still ahead, the same `match:intro` order. Do not replay the intro after countdown has started.
- No audio files on the server. No TTS.

## Out of scope

- Per-player name recordings, crowd ducking, post-score lines, substitutions.
- Renumbering when someone leaves. The number stays unused.

## Allowed files

- `docs/REALTIME.md` and `docs/DATABASE.md` (the fields above, first)
- `wings_of_power_backend/src/modules/game/**`
- `wings_of_power_backend/prisma/**`
- `wings_of_power_backend/test/**`
- This task file

## Manual test (two simulators)

1. Automated: a 2-player match emits one `match:intro` with numbers 1 and 2 before any `match:countdown`. A 10-player match emits numbers 1…10 once each.
2. Automated: both sockets receive the same `order` array. A reconnect during the intro gets that order. A reconnect after countdown does not get a second intro.
3. Device script from the app task for 1v1 and for 5v5.
4. Inspect the event. It has nickname and number only. No score call, no power call, no answer text.
5. Leaving mid-intro still ends in the same countdown for the remaining phone, with the original numbers.

## Done when

- The script passes.
- `yarn lint`, `yarn test`, `yarn test:e2e`, `yarn build` pass.
- Status and Notes updated.

## Notes

-
