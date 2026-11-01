import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { UserStatus } from 'prisma/generated/client';
import { UserRepository } from '../../../common/repository/user/user.repository';
import { Role } from './role.enum';

@Injectable()
export class ActiveStudentGuard implements CanActivate {
  constructor(private userRepository: UserRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requestUser = context.switchToHttp().getRequest().user;
    if (!requestUser?.userId) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const user = await this.userRepository.getUserDetails(requestUser.userId);
    if (!user) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    if (user.role === Role.STUDENT && user.status !== UserStatus.ACTIVE) {
      throw new HttpException('PENDING', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return true;
  }
}
