import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { BadgeCode } from 'prisma/generated/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, restoreSeed, TestAppContext } from './helpers/app';

describe('Learning journey (e2e)', () => {
  let context: TestAppContext;
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = Math.random().toString(36).slice(2, 8);
  const storyTitle = `e2e-story-published-${runId}`;
  const draftStoryTitle = `e2e-story-draft-${runId}`;
  const chapterTitle = `e2e-chapter-${runId}`;
  const quizTitle = `e2e-quiz-${runId}`;
  const reportBody = `e2e-report Hurtful words heard today ${runId}`;
  const noteBody = `e2e-note Followed up with counselor ${runId}`;

  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  let studentId: string;

  let storyId: string;
  let draftStoryId: string;
  let chapterId: string;
  let quizId: string;
  let questionId: string;
  let correctOptionId: string;
  let attemptId: string;
  let reportId: string;

  async function cleanE2E() {
    try {
      await prisma.safeSpaceNote.deleteMany({
        where: {
          OR: [
            { body: { startsWith: 'e2e-note' } },
            { report: { body: { startsWith: 'e2e-report' } } },
          ],
        },
      });
      await prisma.safeSpaceReport.deleteMany({
        where: { body: { startsWith: 'e2e-report' } },
      });
      if (studentId) {
        await prisma.studentBadge.deleteMany({
          where: { user_id: studentId },
        });
        await prisma.pointsLedger.deleteMany({
          where: {
            user_id: studentId,
            source: { in: ['STORY_QUIZ', 'BADGE_BONUS'] as any },
          },
        });
      }
      await prisma.badge.updateMany({
        where: { code: BadgeCode.STORY_EXPLORER },
        data: { criteria_json: {} },
      });
      await prisma.quizAnswer.deleteMany({
        where: { attempt: { quiz: { title: { startsWith: 'e2e-' } } } },
      });
      await prisma.quizAttempt.deleteMany({
        where: { quiz: { title: { startsWith: 'e2e-' } } },
      });
      await prisma.questionOption.deleteMany({
        where: { question: { quiz: { title: { startsWith: 'e2e-' } } } },
      });
      await prisma.question.deleteMany({
        where: { quiz: { title: { startsWith: 'e2e-' } } },
      });
      await prisma.quiz.deleteMany({
        where: { title: { startsWith: 'e2e-' } },
      });
      await prisma.chapterProgress.deleteMany({
        where: { chapter: { title: { startsWith: 'e2e-' } } },
      });
      await prisma.readingProgress.deleteMany({
        where: { story: { title: { startsWith: 'e2e-' } } },
      });
      await prisma.page.deleteMany({
        where: { chapter: { title: { startsWith: 'e2e-' } } },
      });
      await prisma.chapterAudio.deleteMany({
        where: { chapter: { title: { startsWith: 'e2e-' } } },
      });
      await prisma.chapter.deleteMany({
        where: { title: { startsWith: 'e2e-' } },
      });
      await prisma.story.deleteMany({
        where: { title: { startsWith: 'e2e-' } },
      });
    } catch {
      // ignore
    }
  }

  beforeAll(async () => {
    context = await createTestApp();
    app = context.app;
    prisma = context.prisma;

    // Ensure seed data is present
    const demoAdmin = await prisma.user.findFirst({
      where: { email: 'admin@demo.school' },
    });
    if (!demoAdmin) {
      await restoreSeed(prisma);
    }

    // Authenticate Admin
    const adminLoginRes = await request(app.getHttpServer())
      .post('/api/auth/admin/login')
      .send({
        email: 'admin@demo.school',
        password: 'change-me',
      })
      .expect(201);
    expect(adminLoginRes.body.success).toBe(true);
    adminToken = adminLoginRes.body.data.accessToken;

    // Authenticate Teacher
    const teacherLoginRes = await request(app.getHttpServer())
      .post('/api/auth/staff/login')
      .send({
        email: 'teacher@demo.school',
        password: 'change-me',
      })
      .expect(201);
    expect(teacherLoginRes.body.success).toBe(true);
    teacherToken = teacherLoginRes.body.data.accessToken;

    // Authenticate Student
    const studentLoginRes = await request(app.getHttpServer())
      .post('/api/auth/student/login')
      .send({
        username: 'student.active',
        password: 'change-me',
      })
      .expect(201);
    expect(studentLoginRes.body.success).toBe(true);
    studentToken = studentLoginRes.body.data.accessToken;
    studentId = studentLoginRes.body.data.user.id;

    await cleanE2E();
  });

  afterAll(async () => {
    await cleanE2E();
    await app.close();
  });

  it('1. Story creation with chapter, pages, audio URL', async () => {
    // 1.1 Admin creates a story
    const storyRes = await request(app.getHttpServer())
      .post('/api/admin/stories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: storyTitle,
        synopsis: 'An e2e learning journey story about kindness and courage',
        coverUrl: 'https://example.com/cover.jpg',
        category: 'FRIENDSHIP',
        ageGroup: 'AGE_6_9',
        estimatedMinutes: 5,
      })
      .expect(201);

    expect(storyRes.body.success).toBe(true);
    expect(storyRes.body.data.title).toBe(storyTitle);
    expect(storyRes.body.data.status).toBe('DRAFT');
    storyId = storyRes.body.data.id;

    // 1.2 Admin adds a chapter
    const chapterRes = await request(app.getHttpServer())
      .post(`/api/admin/stories/${storyId}/chapters`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: chapterTitle,
        number: 1,
      })
      .expect(201);

    expect(chapterRes.body.success).toBe(true);
    expect(chapterRes.body.data.title).toBe(chapterTitle);
    chapterId = chapterRes.body.data.id;

    // 1.3 Admin replaces pages
    const pagesRes = await request(app.getHttpServer())
      .put(`/api/admin/chapters/${chapterId}/pages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        pages: [
          {
            number: 1,
            bodyText: 'Once upon a time in a friendly school...',
            imageUrl: 'https://example.com/page1.jpg',
          },
        ],
      })
      .expect(200);

    expect(pagesRes.body.success).toBe(true);

    // 1.4 Admin sets chapter audio URL
    const audioRes = await request(app.getHttpServer())
      .put(`/api/admin/chapters/${chapterId}/audio`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        audioUrl: 'https://example.com/chapter1_audio.mp3',
        durationMs: 60000,
      })
      .expect(200);

    expect(audioRes.body.success).toBe(true);

    // 1.5 Create a draft story to verify draft visibility separation
    const draftRes = await request(app.getHttpServer())
      .post('/api/admin/stories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: draftStoryTitle,
        synopsis: 'Draft story that should remain hidden from students',
        category: 'KINDNESS',
        ageGroup: 'AGE_6_9',
      })
      .expect(201);

    expect(draftRes.body.success).toBe(true);
    draftStoryId = draftRes.body.data.id;
  });

  it('2. Publish story: Student GET /api/stories sees published, draft is hidden', async () => {
    // 2.1 Admin publishes story
    const publishRes = await request(app.getHttpServer())
      .patch(`/api/admin/stories/${storyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        status: 'PUBLISHED',
      })
      .expect(200);

    expect(publishRes.body.success).toBe(true);
    expect(publishRes.body.data.status).toBe('PUBLISHED');

    // 2.2 Student calls GET /api/stories
    const studentStoriesRes = await request(app.getHttpServer())
      .get('/api/stories')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(studentStoriesRes.body.success).toBe(true);
    const items = studentStoriesRes.body.data.items;
    const foundPublished = items.find((item: any) => item.id === storyId);
    expect(foundPublished).toBeDefined();
    expect(foundPublished.title).toBe(storyTitle);

    const foundDraft = items.find((item: any) => item.id === draftStoryId);
    expect(foundDraft).toBeUndefined();

    // 2.3 Student GET /api/stories/:id returns published story details
    const detailRes = await request(app.getHttpServer())
      .get(`/api/stories/${storyId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(detailRes.body.success).toBe(true);
    expect(detailRes.body.data.id).toBe(storyId);

    // 2.4 Student GET draft story returns 404
    await request(app.getHttpServer())
      .get(`/api/stories/${draftStoryId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(404);
  });

  it('3. Teacher PUT chapter quiz; Student GET quiz JSON does not have is_correct', async () => {
    // 3.1 Teacher sets chapter quiz with 1 MCQ
    const putQuizRes = await request(app.getHttpServer())
      .put(`/api/teacher/chapters/${chapterId}/quiz`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        title: quizTitle,
        questions: [
          {
            type: 'MCQ',
            prompt: 'How did the characters resolve their conflict?',
            hint: 'They used respectful communication.',
            explanation:
              'Listening and apologizing fixed the misunderstanding.',
            options: [
              {
                label: 'Talked kindly and listened',
                is_correct: true,
              },
              {
                label: 'Shouted and walked away',
                is_correct: false,
              },
            ],
          },
        ],
      })
      .expect(200);

    expect(putQuizRes.body.success).toBe(true);
    quizId = putQuizRes.body.data.quizId;
    expect(quizId).toBeDefined();

    // 3.2 Student GET chapter quiz
    const studentQuizRes = await request(app.getHttpServer())
      .get(`/api/chapters/${chapterId}/quiz`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(studentQuizRes.body.success).toBe(true);
    expect(studentQuizRes.body.data.id).toBe(quizId);
    expect(studentQuizRes.body.data.questions).toHaveLength(1);

    const q = studentQuizRes.body.data.questions[0];
    questionId = q.id;
    expect(q.options).toHaveLength(2);

    // Verify student quiz JSON does not leak is_correct or isCorrect
    for (const opt of q.options) {
      expect(opt).not.toHaveProperty('is_correct');
      expect(opt).not.toHaveProperty('isCorrect');
    }
    const rawStudentQuiz = JSON.stringify(studentQuizRes.body);
    expect(rawStudentQuiz).not.toContain('is_correct');
    expect(rawStudentQuiz).not.toContain('isCorrect');

    const correctOpt = q.options.find(
      (opt: any) => opt.label === 'Talked kindly and listened',
    );
    expect(correctOpt).toBeDefined();
    correctOptionId = correctOpt.id;
  });

  it('4. Student reading progress, quiz answer, complete attempt -> STORY_QUIZ points -> chapter complete', async () => {
    // 4.1 Student saves reading progress
    const progressRes = await request(app.getHttpServer())
      .put(`/api/stories/${storyId}/progress`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        chapterId,
        pageNumber: 1,
        percent: 100,
        mode: 'READ',
      })
      .expect(200);

    expect(progressRes.body.success).toBe(true);

    // 4.2 Student starts quiz attempt
    const attemptRes = await request(app.getHttpServer())
      .post(`/api/quizzes/${quizId}/attempts`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(201);

    expect(attemptRes.body.success).toBe(true);
    attemptId = attemptRes.body.data.id;
    expect(attemptId).toBeDefined();

    // 4.3 Student submits correct answer
    const answerRes = await request(app.getHttpServer())
      .post(`/api/attempts/${attemptId}/answers`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        questionId,
        optionId: correctOptionId,
      })
      .expect(201);

    expect(answerRes.body.success).toBe(true);
    expect(answerRes.body.data.isCorrect).toBe(true);

    // 4.4 Student completes quiz attempt
    const completeRes = await request(app.getHttpServer())
      .post(`/api/attempts/${attemptId}/complete`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(201);

    expect(completeRes.body.success).toBe(true);
    expect(completeRes.body.data.scoreCorrect).toBe(1);
    expect(completeRes.body.data.pointsAwarded).toBeGreaterThan(0);

    // 4.5 Student GET /api/student/points shows STORY_QUIZ row
    const pointsRes = await request(app.getHttpServer())
      .get('/api/student/points')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(pointsRes.body.success).toBe(true);
    const items = pointsRes.body.data.items;
    const storyQuizRow = items.find((row: any) => row.source === 'STORY_QUIZ');
    expect(storyQuizRow).toBeDefined();
    expect(storyQuizRow.amount).toBeGreaterThan(0);

    // 4.6 Student marks chapter complete
    const chapterCompleteRes = await request(app.getHttpServer())
      .post(`/api/stories/${storyId}/chapters/${chapterId}/complete`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(201);

    expect(chapterCompleteRes.body.success).toBe(true);
  });

  it('5. Admin PATCH badge criteria_json -> complete quiz -> GET /api/badges shows earned: true', async () => {
    // 5.1 Admin updates badge criteria
    const patchBadgeRes = await request(app.getHttpServer())
      .patch('/api/admin/badges')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: BadgeCode.STORY_EXPLORER,
        criteria_json: {
          chapters_completed: 1,
        },
      })
      .expect(200);

    expect(patchBadgeRes.body.success).toBe(true);

    // 5.2 Re-evaluate badge by completing another quiz attempt now that chapter is complete
    const attempt2Res = await request(app.getHttpServer())
      .post(`/api/quizzes/${quizId}/attempts`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(201);

    const attempt2Id = attempt2Res.body.data.id;

    await request(app.getHttpServer())
      .post(`/api/attempts/${attempt2Id}/answers`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        questionId,
        optionId: correctOptionId,
      })
      .expect(201);

    const complete2Res = await request(app.getHttpServer())
      .post(`/api/attempts/${attempt2Id}/complete`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(201);

    expect(complete2Res.body.success).toBe(true);

    // 5.3 Student GET /api/badges shows STORY_EXPLORER earned: true
    const badgesRes = await request(app.getHttpServer())
      .get('/api/badges')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(badgesRes.body.success).toBe(true);
    const storyExplorerBadge = badgesRes.body.data.find(
      (b: any) => b.code === BadgeCode.STORY_EXPLORER,
    );
    expect(storyExplorerBadge).toBeDefined();
    expect(storyExplorerBadge.earned).toBe(true);
  });

  it('6. Safe Space report: Student GET has no notes, Teacher lists it, Admin adds note, Student still has no notes', async () => {
    // 6.1 Student creates a Safe Space report
    const reportRes = await request(app.getHttpServer())
      .post('/api/safe-space/reports')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        category: 'HURTFUL_WORDS',
        body: reportBody,
        feelSafe: true,
      })
      .expect(201);

    expect(reportRes.body.success).toBe(true);
    reportId = reportRes.body.data.id;
    expect(reportId).toBeDefined();

    // 6.2 Student GET report detail has no staff notes
    const studentDetail1 = await request(app.getHttpServer())
      .get(`/api/safe-space/reports/${reportId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(studentDetail1.body.success).toBe(true);
    expect(studentDetail1.body.data.id).toBe(reportId);
    expect(studentDetail1.body.data).not.toHaveProperty('notes');
    expect(JSON.stringify(studentDetail1.body)).not.toContain('notes');

    // 6.3 Teacher list includes the report
    const teacherReportsRes = await request(app.getHttpServer())
      .get('/api/teacher/safe-space/reports')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);

    expect(teacherReportsRes.body.success).toBe(true);
    const foundReport = teacherReportsRes.body.data.items.find(
      (r: any) => r.id === reportId,
    );
    expect(foundReport).toBeDefined();

    // 6.4 Admin adds a note to the report
    const noteRes = await request(app.getHttpServer())
      .post(`/api/admin/safe-space/reports/${reportId}/notes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        body: noteBody,
      })
      .expect(201);

    expect(noteRes.body.success).toBe(true);

    // 6.5 Admin GET report detail shows the note
    const adminDetailRes = await request(app.getHttpServer())
      .get(`/api/admin/safe-space/reports/${reportId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(adminDetailRes.body.success).toBe(true);
    expect(adminDetailRes.body.data.notes).toHaveLength(1);
    expect(adminDetailRes.body.data.notes[0].body).toBe(noteBody);

    // 6.6 Student GET report detail STILL has no notes
    const studentDetail2 = await request(app.getHttpServer())
      .get(`/api/safe-space/reports/${reportId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(studentDetail2.body.success).toBe(true);
    expect(studentDetail2.body.data).not.toHaveProperty('notes');
    expect(JSON.stringify(studentDetail2.body)).not.toContain('notes');
    expect(JSON.stringify(studentDetail2.body)).not.toContain(noteBody);
  });

  it('7. Leaderboard GET /api/student/leaderboard returns student with kindnessPoints 0 and no real_name', async () => {
    const leaderboardRes = await request(app.getHttpServer())
      .get('/api/student/leaderboard')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(leaderboardRes.body.success).toBe(true);
    const items = leaderboardRes.body.data.items ?? leaderboardRes.body.data;
    expect(Array.isArray(items)).toBe(true);

    const studentEntry = items.find((entry: any) => entry.userId === studentId);
    expect(studentEntry).toBeDefined();
    expect(studentEntry.kindnessPoints).toBe(0);

    // Ensure no real_name or student real name leaks in the leaderboard
    expect(studentEntry).not.toHaveProperty('real_name');
    expect(studentEntry).not.toHaveProperty('realName');
    const rawLeaderboard = JSON.stringify(leaderboardRes.body);
    expect(rawLeaderboard).not.toContain('real_name');
    expect(rawLeaderboard).not.toContain('Alex Chen');
  });
});
