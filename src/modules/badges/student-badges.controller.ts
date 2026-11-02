import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActiveStudentGuard } from '../../common/guard/role/active-student.guard';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BadgesService } from './badges.service';

@ApiTags('badges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ActiveStudentGuard)
@Roles(Role.STUDENT)
@Controller('badges')
export class StudentBadgesController {
  constructor(private readonly badgesService: BadgesService) {}

  @ApiOperation({ summary: 'Get all badges with student earned status' })
  @Get()
  getBadges(@GetUser('userId') userId: string) {
    return this.badgesService.getStudentBadges(userId);
  }

  @ApiOperation({ summary: 'Get badge detail with how to earn and criteria' })
  @Get(':id')
  getBadgeDetail(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.badgesService.getStudentBadgeDetail(userId, id);
  }
}
