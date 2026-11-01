import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActiveStudentGuard } from '../../common/guard/role/active-student.guard';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PutProgressDto } from './dto/progress.dto';
import { ProgressService } from './progress.service';

@ApiTags('progress')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ActiveStudentGuard)
@Roles(Role.STUDENT)
@Controller()
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @ApiOperation({ summary: 'Save reading progress for a story' })
  @Put('stories/:id/progress')
  putProgress(
    @GetUser('userId') userId: string,
    @Param('id') storyId: string,
    @Body() dto: PutProgressDto,
  ) {
    return this.progressService.putStoryProgress(userId, storyId, dto);
  }

  @ApiOperation({ summary: 'Mark a chapter complete' })
  @Post('stories/:id/chapters/:chapterId/complete')
  completeChapter(
    @GetUser('userId') userId: string,
    @Param('id') storyId: string,
    @Param('chapterId') chapterId: string,
  ) {
    return this.progressService.completeChapter(userId, storyId, chapterId);
  }

  @ApiOperation({ summary: 'Student reading progress summary and stories' })
  @Get('student/reading-progress')
  getReadingProgress(@GetUser('userId') userId: string) {
    return this.progressService.getReadingProgress(userId);
  }

  @ApiOperation({ summary: 'Student home dashboard data' })
  @Get('student/home')
  getStudentHome(@GetUser('userId') userId: string) {
    return this.progressService.getStudentHome(userId);
  }
}
