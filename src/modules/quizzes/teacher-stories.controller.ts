import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { QuizzesService } from './quizzes.service';

@ApiTags('teacher-quizzes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TEACHER)
@Controller('teacher/stories')
export class TeacherStoriesController {
  constructor(private readonly quizzesService: QuizzesService) {}

  @ApiOperation({
    summary: 'Published stories for chapter quiz CMS (no media)',
  })
  @Get()
  list(@GetUser('userId') userId: string) {
    return this.quizzesService.listPublishedStories(userId);
  }
}
