import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminStaffController } from './admin-staff.controller';
import { AdminStudentsController } from './admin-students.controller';
import {
  StudentProfileController,
  TeacherProfileController,
} from './profile.controller';
import { ProfileService } from './profile.service';
import { StaffService } from './staff.service';
import { StudentsService } from './students.service';
import { TeacherStudentsController } from './teacher-students.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    AdminStudentsController,
    AdminStaffController,
    TeacherStudentsController,
    TeacherProfileController,
    StudentProfileController,
  ],
  providers: [StudentsService, StaffService, ProfileService],
})
export class UsersModule {}
