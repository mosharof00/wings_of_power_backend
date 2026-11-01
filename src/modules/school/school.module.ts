import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminClassesController } from './admin-classes.controller';
import { ClassesService } from './classes.service';
import { TeacherClassRequestsController } from './teacher-class-requests.controller';
import { TeacherClassesController } from './teacher-classes.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    TeacherClassesController,
    TeacherClassRequestsController,
    AdminClassesController,
  ],
  providers: [ClassesService],
})
export class SchoolModule {}
