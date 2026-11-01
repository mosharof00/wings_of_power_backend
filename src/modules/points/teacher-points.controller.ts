import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AwardPointsDto, PointsQueryDto } from './dto/points.dto';
import { PointsService } from './points.service';

@ApiTags('teacher-points')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TEACHER)
@Controller('teacher/points')
export class TeacherPointsController {
  constructor(private readonly pointsService: PointsService) {}

  @ApiOperation({ summary: 'Award positive points to a student' })
  @Post('award')
  awardPoints(@GetUser('userId') userId: string, @Body() dto: AwardPointsDto) {
    return this.pointsService.awardPoints(userId, dto);
  }

  @ApiOperation({
    summary: 'Paginated points award history for the signed-in teacher',
  })
  @Get('history')
  getHistory(
    @GetUser('userId') userId: string,
    @Query() query: PointsQueryDto,
  ) {
    return this.pointsService.getTeacherHistory(userId, query);
  }
}
