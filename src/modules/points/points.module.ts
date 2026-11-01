import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminPointRulesController } from './admin-point-rules.controller';
import { PointsService } from './points.service';
import { StudentPointsController } from './student-points.controller';
import { TeacherPointsController } from './teacher-points.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    StudentPointsController,
    TeacherPointsController,
    AdminPointRulesController,
  ],
  providers: [PointsService],
  exports: [PointsService],
})
export class PointsModule {}
