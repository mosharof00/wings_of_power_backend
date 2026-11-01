import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ClassesService } from './classes.service';
import { ClassQueryDto } from './dto/class-query.dto';

@ApiTags('teacher-classes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TEACHER)
@Controller('teacher')
export class TeacherClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @ApiOperation({ summary: 'Classes assigned to the signed-in teacher' })
  @Get('classes')
  list(@GetUser('userId') userId: string, @Query() query: ClassQueryDto) {
    return this.classesService.list(userId, query);
  }

  @ApiOperation({ summary: 'Class overview' })
  @Get('classes/:id')
  detail(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.classesService.detail(userId, id);
  }

  @ApiOperation({ summary: 'Pending join requests for a class' })
  @Get('classes/:id/join-requests')
  joinRequests(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Query() query: ClassQueryDto,
  ) {
    return this.classesService.joinRequests(userId, id, query);
  }

  @ApiOperation({ summary: 'Approve a pending student' })
  @Post('join-requests/:id/approve')
  approve(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.classesService.approve(userId, id);
  }

  @ApiOperation({ summary: 'Reject a pending student' })
  @Post('join-requests/:id/reject')
  reject(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.classesService.reject(userId, id);
  }
}
