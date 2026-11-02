import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BadgesService } from './badges.service';
import { TeacherBadgeMonitorQueryDto } from './dto/badge.dto';

@ApiTags('teacher-badges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TEACHER)
@Controller('teacher/badges')
export class TeacherBadgesController {
  constructor(private readonly badgesService: BadgesService) {}

  @ApiOperation({
    summary: 'Students in teacher classes x badges matrix monitor',
  })
  @Get('monitor')
  getMonitor(
    @GetUser('userId') userId: string,
    @Query() query: TeacherBadgeMonitorQueryDto,
  ) {
    return this.badgesService.getTeacherBadgeMonitor(userId, query);
  }
}
