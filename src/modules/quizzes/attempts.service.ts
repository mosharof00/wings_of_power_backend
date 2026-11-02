import {
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
} from '@nestjs/common';
import {
  PointsSource,
  QuestionType,
  QuizAttemptStatus,
  QuizKind,
  Role,
} from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BadgesService } from '../badges/badges.service';
import { SubmitAnswerDto } from './dto/attempt.dto';

type StoredOption = {
  id: string;
  sort_order: number;
  label: string;
};

type StoredQuestion = {
  id: string;
  sort_order: number;
  type: QuestionType;
  prompt: string;
  options: StoredOption[];
};

type StoredQuiz = {
  id: string;
  kind: QuizKind;
  title: string | null;
  chapter_id: string;
  questions: StoredQuestion[];
};

@Injectable()
export class AttemptsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly badgesService?: BadgesService,
  ) {}

  async getChapterQuiz(studentId: string, chapterId: string) {
    await this.chapterInSchool(studentId, chapterId);
    const quiz = await this.prisma.quiz.findFirst({
      where: {
        chapter_id: chapterId,
        kind: QuizKind.CHAPTER,
      },
      include: {
        questions: {
          orderBy: { sort_order: 'asc' },
          include: {
            options: { orderBy: { sort_order: 'asc' } },
          },
        },
      },
    });
    if (!quiz) {
      throw new HttpException('Quiz not found', HttpStatus.NOT_FOUND);
    }
    return {
      success: true,
      data: this.toStudentQuiz(quiz),
    };
  }

  async getChapterCheckpoint(studentId: string, chapterId: string) {
    await this.chapterInSchool(studentId, chapterId);
    const quiz = await this.prisma.quiz.findFirst({
      where: {
        chapter_id: chapterId,
        kind: QuizKind.CHECKPOINT,
      },
      include: {
        questions: {
          orderBy: { sort_order: 'asc' },
          include: {
            options: { orderBy: { sort_order: 'asc' } },
          },
        },
      },
    });
    if (!quiz) {
      throw new HttpException('Checkpoint not found', HttpStatus.NOT_FOUND);
    }
    return {
      success: true,
      data: this.toStudentQuiz(quiz),
    };
  }

  async startAttempt(studentId: string, quizId: string) {
    const schoolId = await this.studentSchool(studentId);
    const quiz = await this.prisma.quiz.findFirst({
      where: { id: quizId },
      include: {
        chapter: {
          include: { story: true },
        },
      },
    });
    if (!quiz || quiz.chapter?.deleted_at || quiz.chapter?.story?.deleted_at) {
      throw new HttpException('Quiz not found', HttpStatus.NOT_FOUND);
    }
    if (quiz.chapter.story.school_id !== schoolId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    const existing = await this.prisma.quizAttempt.findFirst({
      where: {
        user_id: studentId,
        quiz_id: quizId,
        status: QuizAttemptStatus.IN_PROGRESS,
      },
    });
    if (existing) {
      return {
        success: true,
        data: this.toAttempt(existing),
      };
    }

    const attempt = await this.prisma.quizAttempt.create({
      data: {
        quiz_id: quizId,
        user_id: studentId,
        started_at: new Date(),
        score_correct: 0,
        score_total: 0,
        points_awarded: 0,
        status: QuizAttemptStatus.IN_PROGRESS,
      },
    });

    return {
      success: true,
      data: this.toAttempt(attempt),
    };
  }

  async submitAnswer(
    studentId: string,
    attemptId: string,
    dto: SubmitAnswerDto,
  ) {
    const questionId = dto.questionId ?? dto.question_id;
    if (!questionId) {
      throw new HttpException(
        'Question ID is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const attempt = await this.prisma.quizAttempt.findFirst({
      where: { id: attemptId },
      include: {
        quiz: true,
      },
    });
    if (!attempt) {
      throw new HttpException('Attempt not found', HttpStatus.NOT_FOUND);
    }
    if (attempt.user_id !== studentId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    if (attempt.status !== QuizAttemptStatus.IN_PROGRESS) {
      throw new HttpException(
        'Attempt is already completed',
        HttpStatus.CONFLICT,
      );
    }

    const question = await this.prisma.question.findFirst({
      where: { id: questionId, quiz_id: attempt.quiz_id },
      include: { options: true },
    });
    if (!question) {
      throw new HttpException('Question not found', HttpStatus.NOT_FOUND);
    }

    const existingAnswers = await this.prisma.quizAnswer.findMany({
      where: { attempt_id: attempt.id, question_id: question.id },
      orderBy: { attempt_index: 'asc' },
    });

    if (attempt.quiz.kind === QuizKind.CHAPTER) {
      if (existingAnswers.length >= 1) {
        throw new HttpException(
          'Question already answered',
          HttpStatus.BAD_REQUEST,
        );
      }
    } else if (attempt.quiz.kind === QuizKind.CHECKPOINT) {
      if (existingAnswers.length >= 2) {
        throw new HttpException(
          'Question already answered',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (
        existingAnswers.length === 1 &&
        existingAnswers[0].is_correct === true
      ) {
        throw new HttpException(
          'Question already answered correctly',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const optionId = dto.optionId ?? dto.option_id;
    const freeText = dto.freeText ?? dto.free_text;

    let isCorrect: boolean | null = null;
    if (question.type === QuestionType.FREE_TEXT) {
      isCorrect = null;
    } else {
      if (!optionId) {
        throw new HttpException(
          'Option ID is required for this question type',
          HttpStatus.BAD_REQUEST,
        );
      }
      const option = question.options.find((opt) => opt.id === optionId);
      if (!option) {
        throw new HttpException('Option not found', HttpStatus.BAD_REQUEST);
      }
      isCorrect = option.is_correct;
    }

    const attemptIndex = existingAnswers.length + 1;

    const answer = await this.prisma.quizAnswer.create({
      data: {
        attempt_id: attempt.id,
        question_id: question.id,
        option_id: optionId ?? null,
        free_text: freeText ? freeText.trim() : null,
        is_correct: isCorrect,
        attempt_index: attemptIndex,
      },
    });

    let isFinished = true;
    let hint: string | null = null;
    let explanation: string | null = null;

    if (attempt.quiz.kind === QuizKind.CHECKPOINT) {
      if (attemptIndex === 1) {
        if (isCorrect === true) {
          isFinished = true;
          hint = null;
          explanation = question.explanation ?? null;
        } else {
          isFinished = false;
          hint = question.hint ?? question.explanation ?? null;
          explanation = question.explanation ?? null;
        }
      } else {
        isFinished = true;
        hint = question.hint ?? null;
        explanation = question.explanation ?? null;
      }
    } else {
      isFinished = true;
      hint = question.hint ?? null;
      explanation = question.explanation ?? null;
    }

    return {
      success: true,
      data: {
        id: answer.id,
        attemptId: answer.attempt_id,
        attempt_id: answer.attempt_id,
        questionId: answer.question_id,
        question_id: answer.question_id,
        optionId: answer.option_id,
        option_id: answer.option_id,
        isCorrect: answer.is_correct,
        is_correct: answer.is_correct,
        attemptIndex: answer.attempt_index,
        attempt_index: answer.attempt_index,
        isFinished,
        is_finished: isFinished,
        finished: isFinished,
        hint,
        explanation,
      },
    };
  }

  async completeAttempt(studentId: string, attemptId: string) {
    const attempt = await this.prisma.quizAttempt.findFirst({
      where: { id: attemptId },
      include: {
        quiz: true,
        user: true,
      },
    });
    if (!attempt) {
      throw new HttpException('Attempt not found', HttpStatus.NOT_FOUND);
    }
    if (attempt.user_id !== studentId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    if (attempt.status === QuizAttemptStatus.COMPLETED) {
      throw new HttpException(
        'Attempt is already completed',
        HttpStatus.CONFLICT,
      );
    }

    const questions = await this.prisma.question.findMany({
      where: { quiz_id: attempt.quiz_id },
    });

    const answers = await this.prisma.quizAnswer.findMany({
      where: { attempt_id: attempt.id },
      orderBy: { attempt_index: 'asc' },
    });

    let scoreCorrect = 0;
    for (const question of questions) {
      const qAnswers = answers.filter((a) => a.question_id === question.id);
      if (qAnswers.some((a) => a.is_correct === true)) {
        scoreCorrect += 1;
      }
    }
    const scoreTotal = questions.length;

    let pointRuleValue = 1;
    if (attempt.user?.school_id) {
      const rule = await this.prisma.pointRule.findFirst({
        where: {
          school_id: attempt.user.school_id,
          key: 'STORY_QUESTION',
        },
      });
      if (rule) {
        pointRuleValue = rule.value_int;
      }
    }

    const pointsAwarded = Math.max(0, scoreCorrect * pointRuleValue);

    const completed = await this.prisma.quizAttempt.update({
      where: { id: attempt.id },
      data: {
        status: QuizAttemptStatus.COMPLETED,
        completed_at: new Date(),
        score_correct: scoreCorrect,
        score_total: scoreTotal,
        points_awarded: pointsAwarded,
      },
    });

    await this.prisma.pointsLedger.create({
      data: {
        user_id: studentId,
        source: PointsSource.STORY_QUIZ,
        amount: pointsAwarded,
        kindness_amount: 0,
        label: attempt.quiz.title ?? 'Story Quiz',
        ref_type: 'QuizAttempt',
        ref_id: attempt.id,
        awarded_by_id: null,
      },
    });

    const chapterId = attempt.quiz.chapter_id;
    const currentPercent =
      scoreTotal > 0 ? Math.round((100 * scoreCorrect) / scoreTotal) : 0;

    const existingProgress = await this.prisma.chapterProgress.findUnique({
      where: {
        user_id_chapter_id: {
          user_id: studentId,
          chapter_id: chapterId,
        },
      },
    });

    const quizBestPercent =
      existingProgress?.quiz_best_percent !== null &&
      existingProgress?.quiz_best_percent !== undefined
        ? Math.max(existingProgress.quiz_best_percent, currentPercent)
        : currentPercent;

    await this.prisma.chapterProgress.upsert({
      where: {
        user_id_chapter_id: {
          user_id: studentId,
          chapter_id: chapterId,
        },
      },
      create: {
        user_id: studentId,
        chapter_id: chapterId,
        percent: 0,
        quiz_best_percent: quizBestPercent,
      },
      update: {
        quiz_best_percent: quizBestPercent,
      },
    });

    if (this.badgesService) {
      await this.badgesService.evaluate(studentId);
    }

    return {
      success: true,
      message: 'Attempt completed',
      data: {
        ...this.toAttempt(completed),
        quizBestPercent,
        quiz_best_percent: quizBestPercent,
      },
    };
  }

  private toStudentQuiz(quiz: StoredQuiz | any) {
    return {
      id: quiz.id,
      kind: quiz.kind,
      title: quiz.title,
      chapterId: quiz.chapter_id,
      chapter_id: quiz.chapter_id,
      questions: quiz.questions.map((question: any) => ({
        id: question.id,
        sortOrder: question.sort_order,
        sort_order: question.sort_order,
        type: question.type,
        prompt: question.prompt,
        options: question.options.map((option: any) => ({
          id: option.id,
          sortOrder: option.sort_order,
          sort_order: option.sort_order,
          label: option.label,
        })),
      })),
    };
  }

  private toAttempt(attempt: any) {
    return {
      id: attempt.id,
      quizId: attempt.quiz_id,
      quiz_id: attempt.quiz_id,
      userId: attempt.user_id,
      user_id: attempt.user_id,
      startedAt: attempt.started_at,
      started_at: attempt.started_at,
      completedAt: attempt.completed_at,
      completed_at: attempt.completed_at,
      scoreCorrect: attempt.score_correct,
      score_correct: attempt.score_correct,
      scoreTotal: attempt.score_total,
      score_total: attempt.score_total,
      pointsAwarded: attempt.points_awarded,
      points_awarded: attempt.points_awarded,
      status: attempt.status,
    };
  }

  private async studentSchool(userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user || user.role !== Role.STUDENT) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    if (!user.school_id) {
      throw new HttpException(
        'School is not set up',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return user.school_id;
  }

  private async chapterInSchool(studentId: string, chapterId: string) {
    const schoolId = await this.studentSchool(studentId);
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId },
      include: { story: true },
    });
    if (!chapter || chapter.deleted_at || chapter.story?.deleted_at) {
      throw new HttpException('Chapter not found', HttpStatus.NOT_FOUND);
    }
    if (chapter.story?.school_id !== schoolId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    return chapter;
  }
}
