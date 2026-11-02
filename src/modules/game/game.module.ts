import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProgressModule } from '../progress/progress.module';
import { AdminGameController } from './admin-game.controller';
import { GameService } from './game.service';
import { QueueService } from './queue.service';
import { StudentGameController } from './student-game.controller';

@Module({
  imports: [AuthModule, ProgressModule],
  controllers: [StudentGameController, AdminGameController],
  providers: [GameService, QueueService],
  exports: [GameService, QueueService],
})
export class GameModule {}
