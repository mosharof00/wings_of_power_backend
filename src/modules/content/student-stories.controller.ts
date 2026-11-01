import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActiveStudentGuard } from '../../common/guard/role/active-student.guard';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StudentStoryQueryDto } from './dto/story-list.dto';
import { StoriesService } from './stories.service';

@ApiTags('student-stories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ActiveStudentGuard)
@Roles(Role.STUDENT)
@Controller('stories')
export class StudentStoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  @ApiOperation({ summary: 'Published stories in the student school' })
  @Get()
  list(
    @GetUser('userId') userId: string,
    @Query() query: StudentStoryQueryDto,
  ) {
    return this.storiesService.studentList(userId, query);
  }

  @ApiOperation({ summary: 'Published story and chapter list' })
  @Get(':id')
  detail(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.storiesService.studentDetail(userId, id);
  }

  @ApiOperation({ summary: 'Chapter pages and audio' })
  @Get(':id/chapters/:chapterId')
  chapter(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Param('chapterId') chapterId: string,
  ) {
    return this.storiesService.studentChapter(userId, id, chapterId);
  }
}
