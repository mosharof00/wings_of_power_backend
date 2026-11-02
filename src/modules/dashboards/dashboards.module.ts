import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ProgressModule } from '../progress/progress.module';
import { AdminDashboardController } from './admin-dashboard.controller';
import { DashboardsService } from './dashboards.service';
import { TeacherDashboardController } from './teacher-dashboard.controller';

@Module({
  imports: [PrismaModule, AuthModule, ProgressModule],
  controllers: [TeacherDashboardController, AdminDashboardController],
  providers: [DashboardsService],
  exports: [DashboardsService],
})
export class DashboardsModule {}
