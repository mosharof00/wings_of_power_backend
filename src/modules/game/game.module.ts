import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import appConfig from '../../config/app.config';
import { AuthModule } from '../auth/auth.module';
import { ProgressModule } from '../progress/progress.module';
import { AdminGameController } from './admin-game.controller';
import { AdminPacksController } from './admin-packs.controller';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';
import { MatchmakingService } from './matchmaking.service';
import { PacksService } from './packs.service';
import { QueueService } from './queue.service';
import { RoundService } from './round.service';
import { StudentGameController } from './student-game.controller';
import { TeacherPacksController } from './teacher-packs.controller';

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
  controllers: [
    StudentGameController,
    AdminGameController,
    TeacherPacksController,
    AdminPacksController,
  ],
  providers: [
    GameService,
    QueueService,
    MatchmakingService,
    RoundService,
    GameGateway,
    PacksService,
  ],
  exports: [
    GameService,
    QueueService,
    MatchmakingService,
    RoundService,
    GameGateway,
    PacksService,
  ],
})
export class GameModule {}
