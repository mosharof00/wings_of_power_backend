-- D59: dynamic StoryTheme replaces StoryCategory enum

CREATE TABLE "StoryTheme" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "cover_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryTheme_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoryTheme_slug_key" ON "StoryTheme"("slug");

INSERT INTO "StoryTheme" ("id", "name", "slug", "sort_order", "is_active", "created_at", "updated_at") VALUES
  ('theme_kindness', 'Kindness', 'kindness', 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('theme_courage', 'Courage', 'courage', 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('theme_cyberbullying', 'Cyberbullying', 'cyberbullying', 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('theme_friendship', 'Friendship', 'friendship', 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('theme_other', 'Other', 'other', 90, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "Story" ADD COLUMN "theme_id" TEXT;

UPDATE "Story" SET "theme_id" = CASE "category"::text
  WHEN 'KINDNESS' THEN 'theme_kindness'
  WHEN 'COURAGE' THEN 'theme_courage'
  WHEN 'CYBERBULLYING' THEN 'theme_cyberbullying'
  WHEN 'FRIENDSHIP' THEN 'theme_friendship'
  ELSE 'theme_other'
END;

ALTER TABLE "Story" ALTER COLUMN "theme_id" SET NOT NULL;

DROP INDEX IF EXISTS "Story_school_id_status_age_group_category_idx";

ALTER TABLE "Story" DROP COLUMN "category";

DROP TYPE IF EXISTS "StoryCategory";

CREATE INDEX "Story_school_id_status_age_group_theme_id_idx" ON "Story"("school_id", "status", "age_group", "theme_id");

ALTER TABLE "Story" ADD CONSTRAINT "Story_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "StoryTheme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
