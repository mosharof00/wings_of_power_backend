import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { QuestionType, QuizKind, Role } from 'prisma/generated/client';
import { Role as GuardRole } from '../../common/guard/role/role.enum';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { UserRepository } from '../../common/repository/user/user.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizzesService } from './quizzes.service';
import { TeacherQuizzesController } from './teacher-quizzes.controller';

describe('QuizzesService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
    },
    chapter: {
      findFirst: jest.fn(),
    },
    quiz: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    question: {
      findMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    questionOption: {
      deleteMany: jest.fn(),
    },
  };

  const service = new QuizzesService(prisma as unknown as PrismaService);

  const teacher = {
    id: 'teacher-1',
    role: Role.TEACHER,
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

  it('PUT creates CHAPTER quiz and options', async () => {
    prisma.user.findFirst.mockResolvedValue(teacher);
    prisma.chapter.findFirst.mockResolvedValue(chapter);
    prisma.quiz.findFirst.mockResolvedValue(null);
    prisma.quiz.create.mockResolvedValue({
      id: 'quiz-1',
      chapter_id: 'ch-1',
      kind: QuizKind.CHAPTER,
      created_by_id: 'teacher-1',
    });
    prisma.question.findMany.mockResolvedValue([]);
    prisma.question.create.mockImplementation(async ({ data }) => ({
      id: 'q-1',
      ...data,
    }));

    const result = await service.upsert('teacher-1', 'ch-1', {
      title: 'Chapter 1 Quiz',
      questions: [
        {
          type: QuestionType.MCQ,
          prompt: 'What did Gabriel do?',
          hint: 'Think about kindness',
          explanation: 'He smiled and helped',
          options: [
            { label: 'Walked away', isCorrect: false },
            { label: 'Helped up', isCorrect: true },
          ],
        },
      ],
    });

    expect(prisma.quiz.create).toHaveBeenCalledWith({
      data: {
        chapter_id: 'ch-1',
        kind: QuizKind.CHAPTER,
        title: 'Chapter 1 Quiz',
        created_by_id: 'teacher-1',
      },
    });

    expect(prisma.question.create).toHaveBeenCalledWith({
      data: {
        quiz_id: 'quiz-1',
        sort_order: 0,
        type: QuestionType.MCQ,
        prompt: 'What did Gabriel do?',
        hint: 'Think about kindness',
        explanation: 'He smiled and helped',
        options: {
          create: [
            { sort_order: 0, label: 'Walked away', is_correct: false },
            { sort_order: 1, label: 'Helped up', is_correct: true },
          ],
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.data.quizId).toBe('quiz-1');
    expect(result.data.checkpointId).toBeNull();
  });

  it('second PUT replaces questions (old prompt is gone)', async () => {
    prisma.user.findFirst.mockResolvedValue(teacher);
    prisma.chapter.findFirst.mockResolvedValue(chapter);
    prisma.quiz.findFirst.mockResolvedValue({
      id: 'quiz-1',
      chapter_id: 'ch-1',
      kind: QuizKind.CHAPTER,
    });
    prisma.quiz.update.mockResolvedValue({
      id: 'quiz-1',
      chapter_id: 'ch-1',
      kind: QuizKind.CHAPTER,
    });
    prisma.question.findMany.mockResolvedValue([
      { id: 'q-old-1' },
      { id: 'q-old-2' },
    ]);
    prisma.questionOption.deleteMany.mockResolvedValue({ count: 4 });
    prisma.question.deleteMany.mockResolvedValue({ count: 2 });
    prisma.question.create.mockResolvedValue({ id: 'q-new-1' });

    await service.upsert('teacher-1', 'ch-1', {
      title: 'Updated Quiz',
      questions: [
        {
          type: QuestionType.MCQ,
          prompt: 'Brand new prompt',
          options: [{ label: 'New Option A', isCorrect: true }],
        },
      ],
    });

    expect(prisma.questionOption.deleteMany).toHaveBeenCalledWith({
      where: { question_id: { in: ['q-old-1', 'q-old-2'] } },
    });
    expect(prisma.question.deleteMany).toHaveBeenCalledWith({
      where: { quiz_id: 'quiz-1' },
    });
    expect(prisma.question.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        quiz_id: 'quiz-1',
        prompt: 'Brand new prompt',
      }),
    });
  });

  it('MCQ with no correct option → 400', async () => {
    prisma.user.findFirst.mockResolvedValue(teacher);
    prisma.chapter.findFirst.mockResolvedValue(chapter);

    try {
      await service.upsert('teacher-1', 'ch-1', {
        questions: [
          {
            type: QuestionType.MCQ,
            prompt: 'No correct option question',
            options: [
              { label: 'Option 1', isCorrect: false },
              { label: 'Option 2', isCorrect: false },
            ],
          },
        ],
      });
      throw new Error('expected bad request');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(400);
      expect((error as HttpException).getResponse()).toBe(
        'Question needs a correct option',
      );
    }

    try {
      await service.upsert('teacher-1', 'ch-1', {
        questions: [
          {
            type: QuestionType.TRUE_FALSE,
            prompt: 'True or false question with no correct',
            options: [
              { label: 'True', isCorrect: false },
              { label: 'False', isCorrect: false },
            ],
          },
        ],
      });
      throw new Error('expected bad request');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(400);
    }
  });

  it('checkpoint object creates a second quiz with kind: CHECKPOINT', async () => {
    prisma.user.findFirst.mockResolvedValue(teacher);
    prisma.chapter.findFirst.mockResolvedValue(chapter);
    prisma.quiz.findFirst.mockResolvedValue(null);
    prisma.quiz.create
      .mockResolvedValueOnce({
        id: 'quiz-chapter-1',
        kind: QuizKind.CHAPTER,
      })
      .mockResolvedValueOnce({
        id: 'quiz-checkpoint-1',
        kind: QuizKind.CHECKPOINT,
      });
    prisma.question.findMany.mockResolvedValue([]);
    prisma.question.create.mockResolvedValue({ id: 'q-1' });

    const result = await service.upsert('teacher-1', 'ch-1', {
      title: 'Chapter Quiz',
      questions: [
        {
          type: QuestionType.MCQ,
          prompt: 'Chapter Question',
          options: [{ label: 'Answer', isCorrect: true }],
        },
      ],
      checkpoint: {
        title: 'Checkpoint Quiz',
        questions: [
          {
            type: QuestionType.MCQ,
            prompt: 'Checkpoint Question',
            hint: 'Mid-chapter hint',
            options: [{ label: 'Checkpoint Answer', isCorrect: true }],
          },
        ],
      },
    });

    expect(prisma.quiz.create).toHaveBeenCalledWith({
      data: {
        chapter_id: 'ch-1',
        kind: QuizKind.CHAPTER,
        title: 'Chapter Quiz',
        created_by_id: 'teacher-1',
      },
    });

    expect(prisma.quiz.create).toHaveBeenCalledWith({
      data: {
        chapter_id: 'ch-1',
        kind: QuizKind.CHECKPOINT,
        title: 'Checkpoint Quiz',
        created_by_id: 'teacher-1',
      },
    });

    expect(result.data.quizId).toBe('quiz-chapter-1');
    expect(result.data.checkpointId).toBe('quiz-checkpoint-1');
  });

  it('teacher in another school → 403', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'teacher-other',
      role: Role.TEACHER,
      school_id: 'school-other',
    });
    prisma.chapter.findFirst.mockResolvedValue({
      id: 'ch-1',
      deleted_at: null,
      story: {
        id: 'story-1',
        school_id: 'school-1',
        deleted_at: null,
      },
    });

    try {
      await service.upsert('teacher-other', 'ch-1', {
        questions: [
          {
            type: QuestionType.MCQ,
            prompt: 'Question',
            options: [{ label: 'Option', isCorrect: true }],
          },
        ],
      });
      throw new Error('expected forbidden');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(403);
    }

    try {
      await service.get('teacher-other', 'ch-1');
      throw new Error('expected forbidden');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(403);
    }
  });

  it('GET includes is_correct', async () => {
    prisma.user.findFirst.mockResolvedValue(teacher);
    prisma.chapter.findFirst.mockResolvedValue(chapter);
    prisma.quiz.findMany.mockResolvedValue([
      {
        id: 'quiz-1',
        kind: QuizKind.CHAPTER,
        title: 'Chapter 1 Quiz',
        questions: [
          {
            id: 'q-1',
            sort_order: 0,
            type: QuestionType.MCQ,
            prompt: 'Who helped Gabriel?',
            hint: 'A classmate',
            explanation: 'Kindness helps all',
            options: [
              {
                id: 'opt-1',
                sort_order: 0,
                label: 'Sarah',
                is_correct: true,
              },
              {
                id: 'opt-2',
                sort_order: 1,
                label: 'Nobody',
                is_correct: false,
              },
            ],
          },
        ],
      },
      {
        id: 'cp-1',
        kind: QuizKind.CHECKPOINT,
        title: 'Checkpoint 1',
        questions: [
          {
            id: 'q-cp-1',
            sort_order: 0,
            type: QuestionType.TRUE_FALSE,
            prompt: 'Is helping others an upstander action?',
            hint: null,
            explanation: null,
            options: [
              {
                id: 'opt-3',
                sort_order: 0,
                label: 'True',
                is_correct: true,
              },
              {
                id: 'opt-4',
                sort_order: 1,
                label: 'False',
                is_correct: false,
              },
            ],
          },
        ],
      },
    ]);

    const result = await service.get('teacher-1', 'ch-1');

    expect(result.success).toBe(true);
    expect(result.data.quiz).not.toBeNull();
    expect(result.data.quiz?.questions[0].options[0].is_correct).toBe(true);
    expect(result.data.quiz?.questions[0].options[0].isCorrect).toBe(true);
    expect(result.data.quiz?.questions[0].options[1].is_correct).toBe(false);
    expect(result.data.quiz?.questions[0].options[1].isCorrect).toBe(false);
    expect(result.data.checkpoint).not.toBeNull();
    expect(result.data.checkpoint?.questions[0].options[0].is_correct).toBe(
      true,
    );
  });

  it('FREE_TEXT question with zero options succeeds', async () => {
    prisma.user.findFirst.mockResolvedValue(teacher);
    prisma.chapter.findFirst.mockResolvedValue(chapter);
    prisma.quiz.findFirst.mockResolvedValue(null);
    prisma.quiz.create.mockResolvedValue({
      id: 'quiz-free',
      kind: QuizKind.CHAPTER,
    });
    prisma.question.findMany.mockResolvedValue([]);
    prisma.question.create.mockResolvedValue({ id: 'q-free-1' });

    const result = await service.upsert('teacher-1', 'ch-1', {
      title: 'Free text reflection',
      questions: [
        {
          type: QuestionType.FREE_TEXT,
          prompt: 'Describe how you stood up for a friend',
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(prisma.question.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: QuestionType.FREE_TEXT,
        prompt: 'Describe how you stood up for a friend',
      }),
    });
  });

  it('chapter not found → 404', async () => {
    prisma.user.findFirst.mockResolvedValue(teacher);
    prisma.chapter.findFirst.mockResolvedValue(null);

    try {
      await service.get('teacher-1', 'missing-ch');
      throw new Error('expected not found');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(404);
    }
  });

  it('student token is 403 on controller via RolesGuard', async () => {
    const reflector = new Reflector();
    const users = {
      getUserDetails: jest.fn().mockResolvedValue({ role: GuardRole.STUDENT }),
    };
    const guard = new RolesGuard(reflector, users as unknown as UserRepository);
    const context = {
      getHandler: () => TeacherQuizzesController.prototype.get,
      getClass: () => TeacherQuizzesController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: 'student-1' } }),
      }),
    } as unknown as ExecutionContext;

    try {
      await guard.canActivate(context);
      throw new Error('expected forbidden');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(403);
    }
  });
});
