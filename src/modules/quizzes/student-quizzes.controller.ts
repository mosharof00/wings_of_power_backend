import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActiveStudentGuard } from '../../common/guard/role/active-student.guard';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AttemptsService } from './attempts.service';
import { SubmitAnswerDto } from './dto/attempt.dto';

@ApiTags('student-quizzes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ActiveStudentGuard)
@Roles(Role.STUDENT)
@Controller()
export class StudentQuizzesController {
  constructor(private readonly attemptsService: AttemptsService) {}

  @ApiOperation({ summary: 'Chapter quiz for student' })
  @Get('chapters/:chapterId/quiz')
  getQuiz(
    @GetUser('userId') userId: string,
    @Param('chapterId') chapterId: string,
  ) {
    return this.attemptsService.getChapterQuiz(userId, chapterId);
  }

  @ApiOperation({ summary: 'Chapter checkpoint for student' })
  @Get('chapters/:chapterId/checkpoint')
  getCheckpoint(
    @GetUser('userId') userId: string,
    @Param('chapterId') chapterId: string,
  ) {
    return this.attemptsService.getChapterCheckpoint(userId, chapterId);
  }

  @ApiOperation({ summary: 'Start or resume an attempt for a quiz' })
  @Post('quizzes/:quizId/attempts')
  startAttempt(
    @GetUser('userId') userId: string,
    @Param('quizId') quizId: string,
  ) {
    return this.attemptsService.startAttempt(userId, quizId);
  }

  @ApiOperation({ summary: 'Submit an answer for an attempt' })
  @Post('attempts/:id/answers')
  submitAnswer(
    @GetUser('userId') userId: string,
    @Param('id') attemptId: string,
    @Body() dto: SubmitAnswerDto,
  ) {
    return this.attemptsService.submitAnswer(userId, attemptId, dto);
  }

  @ApiOperation({ summary: 'Complete an attempt and write points' })
  @Post('attempts/:id/complete')
  completeAttempt(
    @GetUser('userId') userId: string,
    @Param('id') attemptId: string,
  ) {
    return this.attemptsService.completeAttempt(userId, attemptId);
  }
}
