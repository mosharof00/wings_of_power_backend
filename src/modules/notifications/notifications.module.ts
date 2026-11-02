import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsService } from './notifications.service';
import { StudentNotificationsController } from './student-notifications.controller';

@Module({
  imports: [AuthModule],
  controllers: [StudentNotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
