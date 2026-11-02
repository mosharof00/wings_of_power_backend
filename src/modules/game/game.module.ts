import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import appConfig from '../../config/app.config';
import { AuthModule } from '../auth/auth.module';
import { ProgressModule } from '../progress/progress.module';
import { AdminGameController } from './admin-game.controller';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';
import { MatchmakingService } from './matchmaking.service';
import { QueueService } from './queue.service';
import { StudentGameController } from './student-game.controller';

@Module({
  imports: [
    AuthModule,
    ProgressModule,
    JwtModule.registerAsync({
      useFactory: async () => ({
        secret: appConfig().jwt.secret,
        signOptions: { expiresIn: +appConfig().jwt.expiry },
      }),
    }),
  ],
  controllers: [StudentGameController, AdminGameController],
  providers: [GameService, QueueService, MatchmakingService, GameGateway],
  exports: [GameService, QueueService, MatchmakingService, GameGateway],
})
export class GameModule {}
