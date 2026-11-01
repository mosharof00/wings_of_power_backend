import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  MoveClassDto,
  StudentListQueryDto,
  UpdateStudentStatusDto,
} from './dto/student-admin.dto';
import { StudentsService } from './students.service';

@ApiTags('admin-students')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminStudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @ApiOperation({ summary: 'Students in the admin school' })
  @Get('students')
  list(@GetUser('userId') userId: string, @Query() query: StudentListQueryDto) {
    return this.studentsService.adminList(userId, query);
  }

  @ApiOperation({ summary: 'Student detail' })
  @Get('students/:id')
  detail(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.studentsService.adminDetail(userId, id);
  }

  @ApiOperation({ summary: 'Set a student ACTIVE or INACTIVE' })
  @Patch('students/:id')
  updateStatus(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateStudentStatusDto,
  ) {
    return this.studentsService.updateStatus(userId, id, dto);
  }

  @ApiOperation({ summary: 'Approve the student account' })
  @Post('students/:id/approve')
  approve(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.studentsService.approve(userId, id);
  }

  @ApiOperation({ summary: 'Add the student to another class' })
  @Post('students/:id/move-class')
  moveClass(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: MoveClassDto,
  ) {
    return this.studentsService.moveClass(userId, id, dto);
  }
}
