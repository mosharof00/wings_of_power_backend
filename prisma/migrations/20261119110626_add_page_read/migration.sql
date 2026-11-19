-- AlterTable
ALTER TABLE "StoryTheme" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "PageRead" (
    "user_id" TEXT NOT NULL,
    "chapter_id" TEXT NOT NULL,
    "page_number" INTEGER NOT NULL,
    "mode" "ReadingMode" NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageRead_pkey" PRIMARY KEY ("user_id","chapter_id","page_number")
);

-- CreateIndex
CREATE INDEX "PageRead_chapter_id_idx" ON "PageRead"("chapter_id");

-- AddForeignKey
ALTER TABLE "PageRead" ADD CONSTRAINT "PageRead_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageRead" ADD CONSTRAINT "PageRead_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "Chapter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
