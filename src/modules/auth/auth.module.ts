import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { ActiveStudentGuard } from '../../common/guard/role/active-student.guard';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { AuthController } from './auth.controller';
import appConfig from '../../config/app.config';
import { PrismaModule } from '../../prisma/prisma.module';
import { MailModule } from '../../mail/mail.module';
import { HeroesModule } from '../heroes/heroes.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    // JwtModule.register({
    //   secret: appConfig().jwt.secret,
    //   signOptions: { expiresIn: appConfig().jwt.expiry },
    // }),
    JwtModule.registerAsync({
      useFactory: async () => ({
        secret: appConfig().jwt.secret,
        signOptions: { expiresIn: +appConfig().jwt.expiry },
      }),
    }),
    PrismaModule,
    MailModule,
    forwardRef(() => HeroesModule),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    RolesGuard,
    ActiveStudentGuard,
  ],
  exports: [AuthService, RolesGuard, ActiveStudentGuard],
})
export class AuthModule {}
