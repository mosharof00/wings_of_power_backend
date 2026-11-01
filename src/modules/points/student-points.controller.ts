import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActiveStudentGuard } from '../../common/guard/role/active-student.guard';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PointsQueryDto } from './dto/points.dto';
import { PointsService } from './points.service';

@ApiTags('student-points')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ActiveStudentGuard)
@Roles(Role.STUDENT)
@Controller('student/points')
export class StudentPointsController {
  constructor(private readonly pointsService: PointsService) {}

  @ApiOperation({ summary: 'Paginated student points ledger plus today total' })
  @Get()
  getPoints(@GetUser('userId') userId: string, @Query() query: PointsQueryDto) {
    return this.pointsService.getStudentPoints(userId, query);
  }
}
