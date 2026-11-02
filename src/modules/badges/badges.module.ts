import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminBadgesController } from './admin-badges.controller';
import { BadgesService } from './badges.service';
import { StudentBadgesController } from './student-badges.controller';
import { TeacherBadgesController } from './teacher-badges.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    StudentBadgesController,
    AdminBadgesController,
    TeacherBadgesController,
  ],
  providers: [BadgesService],
  exports: [BadgesService],
})
export class BadgesModule {}
