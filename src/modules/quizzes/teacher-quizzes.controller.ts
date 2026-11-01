import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpsertQuizDto } from './dto/upsert-quiz.dto';
import { QuizzesService } from './quizzes.service';

@ApiTags('teacher-quizzes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TEACHER)
@Controller('teacher/chapters')
export class TeacherQuizzesController {
  constructor(private readonly quizzesService: QuizzesService) {}

  @ApiOperation({ summary: 'Chapter quiz and checkpoint for the CMS' })
  @Get(':chapterId/quiz')
  get(
    @GetUser('userId') userId: string,
    @Param('chapterId') chapterId: string,
  ) {
    return this.quizzesService.get(userId, chapterId);
  }

  @ApiOperation({ summary: 'Replace the chapter quiz' })
  @Put(':chapterId/quiz')
  upsert(
    @GetUser('userId') userId: string,
    @Param('chapterId') chapterId: string,
    @Body() dto: UpsertQuizDto,
  ) {
    return this.quizzesService.upsert(userId, chapterId, dto);
  }
}
