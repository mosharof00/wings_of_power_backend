import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActiveStudentGuard } from '../../common/guard/role/active-student.guard';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  SettingsDto,
  UpdateStudentProfileDto,
  UpdateTeacherProfileDto,
} from './dto/staff-profile.dto';
import { ProfileService } from './profile.service';

@ApiTags('teacher-profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TEACHER)
@Controller('teacher')
export class TeacherProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @ApiOperation({ summary: 'Signed-in teacher profile' })
  @Get('profile')
  profile(@GetUser('userId') userId: string) {
    return this.profileService.teacherProfile(userId);
  }

  @ApiOperation({ summary: 'Update the signed-in teacher profile' })
  @Patch('profile')
  updateProfile(
    @GetUser('userId') userId: string,
    @Body() dto: UpdateTeacherProfileDto,
  ) {
    return this.profileService.updateTeacherProfile(userId, dto);
  }

  @ApiOperation({ summary: 'Signed-in teacher settings' })
  @Get('settings')
  settings(@GetUser('userId') userId: string) {
    return this.profileService.teacherSettings(userId);
  }

  @ApiOperation({ summary: 'Merge signed-in teacher settings' })
  @Patch('settings')
  updateSettings(@GetUser('userId') userId: string, @Body() dto: SettingsDto) {
    return this.profileService.updateTeacherSettings(userId, dto);
  }
}

@ApiTags('student-profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ActiveStudentGuard)
@Roles(Role.STUDENT)
@Controller('student')
export class StudentProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @ApiOperation({ summary: 'Signed-in student profile' })
  @Get('profile')
  profile(@GetUser('userId') userId: string) {
    return this.profileService.studentProfile(userId);
  }

  @ApiOperation({ summary: 'Update the signed-in student profile' })
  @Patch('profile')
  updateProfile(
    @GetUser('userId') userId: string,
    @Body() dto: UpdateStudentProfileDto,
  ) {
    return this.profileService.updateStudentProfile(userId, dto);
  }

  @ApiOperation({ summary: 'Signed-in student settings' })
  @Get('settings')
  settings(@GetUser('userId') userId: string) {
    return this.profileService.studentSettings(userId);
  }

  @ApiOperation({ summary: 'Merge signed-in student settings' })
  @Patch('settings')
  updateSettings(@GetUser('userId') userId: string, @Body() dto: SettingsDto) {
    return this.profileService.updateStudentSettings(userId, dto);
  }
}
