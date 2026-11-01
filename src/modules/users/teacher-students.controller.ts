import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TeacherStudentListQueryDto } from './dto/student-admin.dto';
import { StudentsService } from './students.service';

@ApiTags('teacher-students')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TEACHER)
@Controller('teacher')
export class TeacherStudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @ApiOperation({ summary: 'Students in the teacher’s classes' })
  @Get('students')
  list(
    @GetUser('userId') userId: string,
    @Query() query: TeacherStudentListQueryDto,
  ) {
    return this.studentsService.teacherList(userId, query);
  }

  @ApiOperation({ summary: 'Student detail for a class the teacher owns' })
  @Get('students/:id')
  detail(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.studentsService.teacherDetail(userId, id);
  }
}
