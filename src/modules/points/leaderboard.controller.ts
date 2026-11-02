import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActiveStudentGuard } from '../../common/guard/role/active-student.guard';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LeaderboardQueryDto } from './dto/leaderboard.dto';
import { PointsService } from './points.service';

@ApiTags('student-leaderboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ActiveStudentGuard)
@Roles(Role.STUDENT)
@Controller('student/leaderboard')
export class LeaderboardController {
  constructor(private readonly pointsService: PointsService) {}

  @ApiOperation({ summary: 'Student kindness leaderboard by class or school' })
  @Get()
  getLeaderboard(
    @GetUser('userId') userId: string,
    @Query() query: LeaderboardQueryDto,
  ) {
    return this.pointsService.getLeaderboard(userId, query);
  }
}
