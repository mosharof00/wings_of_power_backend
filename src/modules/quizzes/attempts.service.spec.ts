import { HttpException } from '@nestjs/common';
import {
  PointsSource,
  QuestionType,
  QuizAttemptStatus,
  QuizKind,
  Role,
} from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AttemptsService } from './attempts.service';

describe('AttemptsService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
    },
    chapter: {
      findFirst: jest.fn(),
    },
    quiz: {
      findFirst: jest.fn(),
    },
    question: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    quizAttempt: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    quizAnswer: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    pointRule: {
      findFirst: jest.fn(),
    },
    pointsLedger: {
      create: jest.fn(),
    },
    chapterProgress: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const service = new AttemptsService(prisma as unknown as PrismaService);

  const student = {
    id: 'student-1',
    role: Role.STUDENT,
    school_id: 'school-1',
  };

  const chapter = {
    id: 'ch-1',
    story_id: 'story-1',
    deleted_at: null,
    story: {
      id: 'story-1',
      school_id: 'school-1',
      deleted_at: null,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET quiz and checkpoint', () => {
    it('student GET does not contain is_correct, hint, or explanation', async () => {
      prisma.user.findFirst.mockResolvedValue(student);
      prisma.chapter.findFirst.mockResolvedValue(chapter);
      prisma.quiz.findFirst.mockResolvedValue({
        id: 'quiz-1',
        kind: QuizKind.CHAPTER,
        title: 'Chapter 1 Quiz',
        chapter_id: 'ch-1',
        questions: [
          {
            id: 'q-1',
            sort_order: 0,
            type: QuestionType.MCQ,
            prompt: 'What did Gabriel do?',
            hint: 'Think about kindness',
            explanation: 'He smiled and helped',
            options: [
              {
                id: 'opt-1',
                sort_order: 0,
                label: 'Walked away',
                is_correct: false,
              },
              {
                id: 'opt-2',
                sort_order: 1,
                label: 'Helped up',
                is_correct: true,
              },
            ],
          },
        ],
      });

      const result = await service.getChapterQuiz('student-1', 'ch-1');

      expect(result.success).toBe(true);
      const q = result.data.questions[0];
      expect(q).not.toHaveProperty('hint');
      expect(q).not.toHaveProperty('explanation');
      expect(q).not.toHaveProperty('is_correct');
      expect(q).not.toHaveProperty('isCorrect');

      const opt1 = q.options[0];
      expect(opt1).not.toHaveProperty('is_correct');
      expect(opt1).not.toHaveProperty('isCorrect');
      expect(opt1.label).toBe('Walked away');

      const opt2 = q.options[1];
      expect(opt2).not.toHaveProperty('is_correct');
      expect(opt2).not.toHaveProperty('isCorrect');
      expect(opt2.label).toBe('Helped up');
    });

    it('student GET checkpoint omits is_correct, hint, and explanation', async () => {
      prisma.user.findFirst.mockResolvedValue(student);
      prisma.chapter.findFirst.mockResolvedValue(chapter);
      prisma.quiz.findFirst.mockResolvedValue({
        id: 'quiz-cp-1',
        kind: QuizKind.CHECKPOINT,
        title: 'Mid-chapter checkpoint',
        chapter_id: 'ch-1',
        questions: [
          {
            id: 'q-cp-1',
            sort_order: 0,
            type: QuestionType.MCQ,
            prompt: 'Are you following along?',
            hint: 'Check page 2',
            explanation: 'It was on page 2',
            options: [
              {
                id: 'opt-cp-1',
                sort_order: 0,
                label: 'Yes',
                is_correct: true,
              },
            ],
          },
        ],
      });

      const result = await service.getChapterCheckpoint('student-1', 'ch-1');

      expect(result.success).toBe(true);
      const q = result.data.questions[0];
      expect(q).not.toHaveProperty('hint');
      expect(q).not.toHaveProperty('explanation');
      expect(q.options[0]).not.toHaveProperty('is_correct');
    });

    it('missing quiz → 404', async () => {
      prisma.user.findFirst.mockResolvedValue(student);
      prisma.chapter.findFirst.mockResolvedValue(chapter);
      prisma.quiz.findFirst.mockResolvedValue(null);

      await expect(service.getChapterQuiz('student-1', 'ch-1')).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('startAttempt', () => {
    it('creates IN_PROGRESS attempt if none exists', async () => {
      prisma.user.findFirst.mockResolvedValue(student);
      prisma.quiz.findFirst.mockResolvedValue({
        id: 'quiz-1',
        chapter: chapter,
      });
      prisma.quizAttempt.findFirst.mockResolvedValue(null);
      prisma.quizAttempt.create.mockResolvedValue({
        id: 'attempt-1',
        quiz_id: 'quiz-1',
        user_id: 'student-1',
        started_at: new Date(),
        completed_at: null,
        score_correct: 0,
        score_total: 0,
        points_awarded: 0,
        status: QuizAttemptStatus.IN_PROGRESS,
      });

      const result = await service.startAttempt('student-1', 'quiz-1');

      expect(result.success).toBe(true);
      expect(result.data.id).toBe('attempt-1');
      expect(result.data.status).toBe(QuizAttemptStatus.IN_PROGRESS);
      expect(prisma.quizAttempt.create).toHaveBeenCalled();
    });

    it('returns existing IN_PROGRESS attempt without duplicate creation', async () => {
      prisma.user.findFirst.mockResolvedValue(student);
      prisma.quiz.findFirst.mockResolvedValue({
        id: 'quiz-1',
        chapter: chapter,
      });
      prisma.quizAttempt.findFirst.mockResolvedValue({
        id: 'existing-attempt',
        quiz_id: 'quiz-1',
        user_id: 'student-1',
        started_at: new Date(),
        completed_at: null,
        score_correct: 0,
        score_total: 0,
        points_awarded: 0,
        status: QuizAttemptStatus.IN_PROGRESS,
      });

      const result = await service.startAttempt('student-1', 'quiz-1');

      expect(result.success).toBe(true);
      expect(result.data.id).toBe('existing-attempt');
      expect(prisma.quizAttempt.create).not.toHaveBeenCalled();
    });
  });

  describe('submitAnswer', () => {
    it('answer marks MCQ against the option flag', async () => {
      prisma.quizAttempt.findFirst.mockResolvedValue({
        id: 'attempt-1',
        quiz_id: 'quiz-1',
        user_id: 'student-1',
        status: QuizAttemptStatus.IN_PROGRESS,
        quiz: { id: 'quiz-1', kind: QuizKind.CHAPTER },
      });
      prisma.question.findFirst.mockResolvedValue({
        id: 'q-1',
        quiz_id: 'quiz-1',
        type: QuestionType.MCQ,
        hint: 'Kindness hint',
        explanation: 'Kindness explanation',
        options: [
          { id: 'opt-wrong', is_correct: false },
          { id: 'opt-correct', is_correct: true },
        ],
      });
      prisma.quizAnswer.findMany.mockResolvedValue([]);
      prisma.quizAnswer.create.mockImplementation(async ({ data }) => ({
        id: 'ans-1',
        ...data,
      }));

      // Test correct option
      const resCorrect = await service.submitAnswer('student-1', 'attempt-1', {
        questionId: 'q-1',
        optionId: 'opt-correct',
      });
      expect(resCorrect.success).toBe(true);
      expect(resCorrect.data.isCorrect).toBe(true);
      expect(resCorrect.data.is_correct).toBe(true);
      expect(prisma.quizAnswer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          is_correct: true,
          attempt_index: 1,
        }),
      });

      // Test wrong option
      const resWrong = await service.submitAnswer('student-1', 'attempt-1', {
        questionId: 'q-1',
        optionId: 'opt-wrong',
      });
      expect(resWrong.success).toBe(true);
      expect(resWrong.data.isCorrect).toBe(false);
      expect(resWrong.data.is_correct).toBe(false);
      expect(prisma.quizAnswer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          is_correct: false,
          attempt_index: 1,
        }),
      });
    });

    it('checkpoint first wrong does not set the question finished; second answer does', async () => {
      const attempt = {
        id: 'attempt-cp',
        quiz_id: 'quiz-cp',
        user_id: 'student-1',
        status: QuizAttemptStatus.IN_PROGRESS,
        quiz: { id: 'quiz-cp', kind: QuizKind.CHECKPOINT },
      };
      const question = {
        id: 'q-cp-1',
        quiz_id: 'quiz-cp',
        type: QuestionType.MCQ,
        hint: 'Checkpoint hint here',
        explanation: 'Checkpoint explanation here',
        options: [
          { id: 'opt-w', is_correct: false },
          { id: 'opt-c', is_correct: true },
        ],
      };

      prisma.quizAttempt.findFirst.mockResolvedValue(attempt);
      prisma.question.findFirst.mockResolvedValue(question);

      // 1st answer: WRONG
      prisma.quizAnswer.findMany.mockResolvedValue([]);
      prisma.quizAnswer.create.mockResolvedValue({
        id: 'ans-1',
        attempt_id: 'attempt-cp',
        question_id: 'q-cp-1',
        option_id: 'opt-w',
        is_correct: false,
        attempt_index: 1,
      });

      const firstAns = await service.submitAnswer('student-1', 'attempt-cp', {
        questionId: 'q-cp-1',
        optionId: 'opt-w',
      });

      expect(firstAns.data.isCorrect).toBe(false);
      expect(firstAns.data.attemptIndex).toBe(1);
      expect(firstAns.data.isFinished).toBe(false);
      expect(firstAns.data.finished).toBe(false);
      expect(firstAns.data.hint).toBe('Checkpoint hint here');

      // 2nd answer: now there's 1 existing wrong answer
      prisma.quizAnswer.findMany.mockResolvedValue([
        {
          id: 'ans-1',
          attempt_id: 'attempt-cp',
          question_id: 'q-cp-1',
          option_id: 'opt-w',
          is_correct: false,
          attempt_index: 1,
        },
      ]);
      prisma.quizAnswer.create.mockResolvedValue({
        id: 'ans-2',
        attempt_id: 'attempt-cp',
        question_id: 'q-cp-1',
        option_id: 'opt-c',
        is_correct: true,
        attempt_index: 2,
      });

      const secondAns = await service.submitAnswer('student-1', 'attempt-cp', {
        questionId: 'q-cp-1',
        optionId: 'opt-c',
      });

      expect(secondAns.data.isCorrect).toBe(true);
      expect(secondAns.data.attemptIndex).toBe(2);
      expect(secondAns.data.isFinished).toBe(true);
      expect(secondAns.data.finished).toBe(true);
    });

    it('free-text answer stores free_text with is_correct: null', async () => {
      prisma.quizAttempt.findFirst.mockResolvedValue({
        id: 'attempt-ft',
        quiz_id: 'quiz-ft',
        user_id: 'student-1',
        status: QuizAttemptStatus.IN_PROGRESS,
        quiz: { id: 'quiz-ft', kind: QuizKind.CHAPTER },
      });
      prisma.question.findFirst.mockResolvedValue({
        id: 'q-ft',
        quiz_id: 'quiz-ft',
        type: QuestionType.FREE_TEXT,
        options: [],
      });
      prisma.quizAnswer.findMany.mockResolvedValue([]);
      prisma.quizAnswer.create.mockImplementation(async ({ data }) => ({
        id: 'ans-ft',
        ...data,
      }));

      const res = await service.submitAnswer('student-1', 'attempt-ft', {
        questionId: 'q-ft',
        freeText: 'I would help him carry the books',
      });

      expect(res.data.isCorrect).toBeNull();
      expect(prisma.quizAnswer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          free_text: 'I would help him carry the books',
          is_correct: null,
          attempt_index: 1,
        }),
      });
    });

    it('rejects attempt of another student with 403', async () => {
      prisma.quizAttempt.findFirst.mockResolvedValue({
        id: 'attempt-1',
        user_id: 'other-student',
        status: QuizAttemptStatus.IN_PROGRESS,
      });

      try {
        await service.submitAnswer('student-1', 'attempt-1', {
          questionId: 'q-1',
        });
        throw new Error('expected forbidden');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(403);
      }
    });
  });

  describe('completeAttempt', () => {
    it('complete writes a ledger row with kindness_amount 0 and amount = correct count when the rule is 1', async () => {
      const attempt = {
        id: 'attempt-comp',
        quiz_id: 'quiz-1',
        user_id: 'student-1',
        status: QuizAttemptStatus.IN_PROGRESS,
        user: student,
        quiz: { id: 'quiz-1', title: 'Chapter Quiz', chapter_id: 'ch-1' },
      };

      prisma.quizAttempt.findFirst.mockResolvedValue(attempt);
      prisma.question.findMany.mockResolvedValue([
        { id: 'q-1', type: QuestionType.MCQ },
        { id: 'q-2', type: QuestionType.MCQ },
        { id: 'q-3', type: QuestionType.MCQ },
      ]);
      prisma.quizAnswer.findMany.mockResolvedValue([
        { question_id: 'q-1', is_correct: true },
        { question_id: 'q-2', is_correct: true },
        { question_id: 'q-3', is_correct: false },
      ]);
      prisma.pointRule.findFirst.mockResolvedValue({
        id: 'pr-1',
        school_id: 'school-1',
        key: 'STORY_QUESTION',
        value_int: 1,
      });
      prisma.quizAttempt.update.mockImplementation(async ({ data }) => ({
        ...attempt,
        ...data,
      }));
      prisma.pointsLedger.create.mockResolvedValue({ id: 'ledger-1' });
      prisma.chapterProgress.findUnique.mockResolvedValue(null);
      prisma.chapterProgress.upsert.mockResolvedValue({
        user_id: 'student-1',
        chapter_id: 'ch-1',
        percent: 0,
        quiz_best_percent: 67,
      });

      const res = await service.completeAttempt('student-1', 'attempt-comp');

      expect(res.success).toBe(true);
      expect(prisma.quizAttempt.update).toHaveBeenCalledWith({
        where: { id: 'attempt-comp' },
        data: expect.objectContaining({
          status: QuizAttemptStatus.COMPLETED,
          score_correct: 2,
          score_total: 3,
          points_awarded: 2,
        }),
      });

      expect(prisma.pointsLedger.create).toHaveBeenCalledWith({
        data: {
          user_id: 'student-1',
          source: PointsSource.STORY_QUIZ,
          amount: 2,
          kindness_amount: 0,
          label: 'Chapter Quiz',
          ref_type: 'QuizAttempt',
          ref_id: 'attempt-comp',
          awarded_by_id: null,
        },
      });

      expect(prisma.chapterProgress.upsert).toHaveBeenCalledWith({
        where: {
          user_id_chapter_id: {
            user_id: 'student-1',
            chapter_id: 'ch-1',
          },
        },
        create: {
          user_id: 'student-1',
          chapter_id: 'ch-1',
          percent: 0,
          quiz_best_percent: 67,
        },
        update: {
          quiz_best_percent: 67,
        },
      });
    });

    it('complete twice → 409', async () => {
      prisma.quizAttempt.findFirst.mockResolvedValue({
        id: 'attempt-done',
        quiz_id: 'quiz-1',
        user_id: 'student-1',
        status: QuizAttemptStatus.COMPLETED,
        user: student,
        quiz: { id: 'quiz-1', chapter_id: 'ch-1' },
      });

      try {
        await service.completeAttempt('student-1', 'attempt-done');
        throw new Error('expected conflict');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(409);
      }
    });

    it('best percent does not decrease', async () => {
      const attempt = {
        id: 'attempt-lower',
        quiz_id: 'quiz-1',
        user_id: 'student-1',
        status: QuizAttemptStatus.IN_PROGRESS,
        user: student,
        quiz: { id: 'quiz-1', title: 'Chapter Quiz', chapter_id: 'ch-1' },
      };

      prisma.quizAttempt.findFirst.mockResolvedValue(attempt);
      prisma.question.findMany.mockResolvedValue([
        { id: 'q-1', type: QuestionType.MCQ },
        { id: 'q-2', type: QuestionType.MCQ },
      ]);
      // 1 of 2 correct = 50%
      prisma.quizAnswer.findMany.mockResolvedValue([
        { question_id: 'q-1', is_correct: true },
        { question_id: 'q-2', is_correct: false },
      ]);
      prisma.pointRule.findFirst.mockResolvedValue(null); // default multiplier 1
      prisma.quizAttempt.update.mockImplementation(async ({ data }) => ({
        ...attempt,
        ...data,
      }));
      prisma.pointsLedger.create.mockResolvedValue({ id: 'ledger-2' });

      // Previous best was 80%
      prisma.chapterProgress.findUnique.mockResolvedValue({
        user_id: 'student-1',
        chapter_id: 'ch-1',
        percent: 0,
        quiz_best_percent: 80,
      });

      const res = await service.completeAttempt('student-1', 'attempt-lower');

      expect(res.data.quizBestPercent).toBe(80);
      expect(prisma.chapterProgress.upsert).toHaveBeenCalledWith({
        where: {
          user_id_chapter_id: {
            user_id: 'student-1',
            chapter_id: 'ch-1',
          },
        },
        create: {
          user_id: 'student-1',
          chapter_id: 'ch-1',
          percent: 0,
          quiz_best_percent: 80,
        },
        update: {
          quiz_best_percent: 80,
        },
      });
    });
  });
});
