import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  QuestionType,
  QuizKind,
  Role,
} from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizQuestionDto, UpsertQuizDto } from './dto/upsert-quiz.dto';

type StoredOption = {
  id: string;
  sort_order: number;
  label: string;
  is_correct: boolean;
};

type StoredQuestion = {
  id: string;
  sort_order: number;
  type: QuestionType;
  prompt: string;
  hint: string | null;
  explanation: string | null;
  options: StoredOption[];
};

type StoredQuiz = {
  id: string;
  kind: QuizKind;
  title: string | null;
  questions: StoredQuestion[];
};

@Injectable()
export class QuizzesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(teacherId: string, chapterId: string) {
    await this.chapterInSchool(teacherId, chapterId);
    const quizzes = await this.prisma.quiz.findMany({
      where: {
        chapter_id: chapterId,
        kind: { in: [QuizKind.CHAPTER, QuizKind.CHECKPOINT] },
      },
      include: {
        questions: {
          orderBy: { sort_order: 'asc' },
          include: { options: { orderBy: { sort_order: 'asc' } } },
        },
      },
    });
    return {
      success: true,
      data: {
        quiz: this.toQuiz(
          quizzes.find((quiz) => quiz.kind === QuizKind.CHAPTER) ?? null,
        ),
        checkpoint: this.toQuiz(
          quizzes.find((quiz) => quiz.kind === QuizKind.CHECKPOINT) ?? null,
        ),
      },
    };
  }

  async upsert(teacherId: string, chapterId: string, dto: UpsertQuizDto) {
    await this.chapterInSchool(teacherId, chapterId);
    const quiz = await this.saveQuiz(
      chapterId,
      teacherId,
      QuizKind.CHAPTER,
      dto.title,
      dto.questions,
    );
    let checkpoint: { id: string } | null = null;
    if (dto.checkpoint) {
      checkpoint = await this.saveQuiz(
        chapterId,
        teacherId,
        QuizKind.CHECKPOINT,
        dto.checkpoint.title,
        dto.checkpoint.questions,
      );
    }
    return {
      success: true,
      message: 'Quiz saved',
      data: {
        quizId: quiz.id,
        checkpointId: checkpoint?.id ?? null,
      },
    };
  }

  private async saveQuiz(
    chapterId: string,
    teacherId: string,
    kind: QuizKind,
    title: string | undefined,
    questions: QuizQuestionDto[],
  ) {
    this.assertQuestions(questions);
    const existing = await this.prisma.quiz.findFirst({
      where: { chapter_id: chapterId, kind },
    });
    const quiz = existing
      ? await this.prisma.quiz.update({
          where: { id: existing.id },
          data: {
            created_by_id: teacherId,
            ...(title !== undefined ? { title: title.trim() || null } : {}),
          },
        })
      : await this.prisma.quiz.create({
          data: {
            chapter_id: chapterId,
            kind,
            title: title?.trim() || null,
            created_by_id: teacherId,
          },
        });
    await this.replaceQuestions(quiz.id, questions);
    return quiz;
  }

  private assertQuestions(questions: QuizQuestionDto[]) {
    for (const question of questions) {
      const needsCorrect =
        question.type === QuestionType.MCQ ||
        question.type === QuestionType.TRUE_FALSE;
      if (
        needsCorrect &&
        !question.options?.some((option) => option.isCorrect)
      ) {
        throw new HttpException(
          'Question needs a correct option',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
  }

  private async replaceQuestions(quizId: string, questions: QuizQuestionDto[]) {
    const existing = await this.prisma.question.findMany({
      where: { quiz_id: quizId },
      select: { id: true },
    });
    const ids = existing.map((question) => question.id);
    if (ids.length) {
      await this.prisma.questionOption.deleteMany({
        where: { question_id: { in: ids } },
      });
      await this.prisma.question.deleteMany({ where: { quiz_id: quizId } });
    }
    for (const [index, question] of questions.entries()) {
      await this.prisma.question.create({
        data: {
          quiz_id: quizId,
          sort_order: index,
          type: question.type,
          prompt: question.prompt.trim(),
          hint: question.hint?.trim() || null,
          explanation: question.explanation?.trim() || null,
          ...(question.options?.length
            ? {
                options: {
                  create: question.options.map((option, optionIndex) => ({
                    sort_order: optionIndex,
                    label: option.label.trim(),
                    is_correct: option.isCorrect,
                  })),
                },
              }
            : {}),
        },
      });
    }
  }

  private toQuiz(quiz: StoredQuiz | null) {
    if (!quiz) {
      return null;
    }
    return {
      id: quiz.id,
      kind: quiz.kind,
      title: quiz.title,
      questions: quiz.questions.map((question) => ({
        id: question.id,
        sortOrder: question.sort_order,
        type: question.type,
        prompt: question.prompt,
        hint: question.hint,
        explanation: question.explanation,
        options: question.options.map((option) => ({
          id: option.id,
          sortOrder: option.sort_order,
          label: option.label,
          isCorrect: option.is_correct,
        })),
      })),
    };
  }

  private async chapterInSchool(teacherId: string, chapterId: string) {
    const teacher = await this.prisma.user.findFirst({
      where: { id: teacherId },
    });
    if (!teacher || teacher.role !== Role.TEACHER) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    if (!teacher.school_id) {
      throw new HttpException(
        'School is not set up',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId },
      include: { story: true },
    });
    if (!chapter || chapter.story.deleted_at) {
      throw new HttpException('Chapter not found', HttpStatus.NOT_FOUND);
    }
    if (chapter.story.school_id !== teacher.school_id) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    return chapter;
  }
}
