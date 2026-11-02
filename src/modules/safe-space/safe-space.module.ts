import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportsService } from './reports.service';
import { StudentReportsController } from './student-reports.controller';

@Module({
  imports: [AuthModule],
  controllers: [StudentReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class SafeSpaceModule {}

