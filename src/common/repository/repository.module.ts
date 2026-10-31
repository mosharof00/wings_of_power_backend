import { Global, Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { UserRepository } from './user/user.repository';
import { UcodeRepository } from './ucode/ucode.repository';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [UserRepository, UcodeRepository],
  exports: [UserRepository, UcodeRepository],
})
export class RepositoryModule {}
