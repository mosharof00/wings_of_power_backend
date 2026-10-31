# T-BE-GAME-001 — Eligibility and how to play

**Status:** Not started
**Pair:** `wings_of_power_app/docs/game/tasks/T-GAME-001.md`
**Phase:** 1
**Depends on:** none
**Plan:** `wings_of_power_app/docs/game/GAME_PLAN.md`

## Goal

`GET /api/game/eligibility` and `GET /api/game/how-to-play` match `docs/API.md`. Alex is eligible. Blake is not. The how-to-play payload is the five steps on the sheet.

## In scope

- New Nest module `src/modules/game/` (module, controller, service, DTOs). Register it from `AppModule`. Follow the existing slice. JWT + student role.
- Response shape already used by the app: `{ success, message, data }`.
- Eligibility `data`: `{ eligible, progress, rules }`. `rules` is `{ requiredStories: 2, requiredChapters: 6, minQuizPercent: 70 }` from `GameEligibilityConfig`, not constants in the controller. `progress` reports stories completed, chapters completed, and best quiz percent so the client can show the modal without recomputing the rule.
- Eligible when `(stories >= requiredStories OR chapters >= requiredChapters) AND bestQuizPercent >= minQuizPercent` (D2).
- Persist config and the progress reads with the `GameEligibilityConfig`, `ReadingProgress`, and `ChapterProgress` fields in `docs/DATABASE.md`. Add only those tables (and the parent School / Story / Chapter rows the FKs require) if they are missing. Do not add match tables. Do not add story HTTP routes.
- Seed Alex eligible and Blake ineligible. Do not commit passwords or `.env` secrets. Document the seed logins in this task’s Notes locally after running, not in git if they are new passwords — point at the seed file instead.
- How to play `data`: the five steps in the plan, titles and bodies taken from `How to Play.png`.

## Out of scope

- Queue, sockets, matches, heroes, packs, admin eligibility editor.
- Template chat or payment modules.
- Using `User.points` as kindness.

## Allowed files

- `wings_of_power_backend/src/modules/game/**`
- `wings_of_power_backend/src/app.module.ts`
- `wings_of_power_backend/prisma/schema.prisma`
- `wings_of_power_backend/prisma/migrations/**` (the new migration only)
- `wings_of_power_backend/prisma/seed.ts` or the existing seed entry the repo already runs
- `wings_of_power_backend/test/**` for this module
- This task file (Status and Notes)

Do not edit `docs/API.md` unless the response fields above are missing there. If you add a field, add it to API.md first in the same task.

## Manual test (two simulators)

1. `yarn test` covers Alex eligible and Blake ineligible, including the OR (6 chapters at 70% with 0 stories is eligible; 2 stories at 69% is not).
2. With the app pair running, Blake’s phone gets `eligible: false`. Alex’s phone gets `eligible: true`.
3. Swap a config row to `requiredStories: 9` and confirm Alex flips to ineligible without an app release. Restore the seed value afterward.
4. How-to-play returns five steps and no scores, timers, or answer keys.
5. A request without a JWT is rejected.

## Done when

- The script passes.
- From `wings_of_power_backend/`: `yarn lint`, `yarn test`, `yarn test:e2e`, `yarn build`.
- Status and Notes updated.

## Notes

-
