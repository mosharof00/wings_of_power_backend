import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminReportsController } from './admin-reports.controller';
import { ReportsService } from './reports.service';
import { StudentReportsController } from './student-reports.controller';
import { TeacherReportsController } from './teacher-reports.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    StudentReportsController,
    TeacherReportsController,
    AdminReportsController,
  ],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class SafeSpaceModule {}
