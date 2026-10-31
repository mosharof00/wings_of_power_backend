import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { Test, TestingModule } from '@nestjs/testing';
import { UcodeRepository } from '../../common/repository/ucode/ucode.repository';
import { UserRepository } from '../../common/repository/user/user.repository';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: {} },
        { provide: MailService, useValue: {} },
        { provide: UserRepository, useValue: {} },
        { provide: UcodeRepository, useValue: {} },
        { provide: getRedisConnectionToken(), useValue: {} },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
