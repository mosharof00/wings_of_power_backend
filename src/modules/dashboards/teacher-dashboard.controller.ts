import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DashboardsService } from './dashboards.service';

@ApiTags('teacher-dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TEACHER)
@Controller('teacher/dashboard')
export class TeacherDashboardController {
  constructor(private readonly dashboardsService: DashboardsService) {}

  @ApiOperation({ summary: 'Teacher dashboard overview and metrics' })
  @Get()
  getDashboard(@GetUser('userId') userId: string) {
    return this.dashboardsService.getTeacherDashboard(userId);
  }
}
