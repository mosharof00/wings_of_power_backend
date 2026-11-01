import { ExecutionContext, HttpException } from '@nestjs/common';
import { UserStatus } from 'prisma/generated/client';
import { UserRepository } from '../../../common/repository/user/user.repository';
import { ActiveStudentGuard } from './active-student.guard';
import { Role } from './role.enum';

function context(userId: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { userId } }),
    }),
  } as ExecutionContext;
}

describe('ActiveStudentGuard', () => {
  const users = { getUserDetails: jest.fn() };
  const guard = new ActiveStudentGuard(users as unknown as UserRepository);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a pending student with 422', async () => {
    users.getUserDetails.mockResolvedValue({
      role: Role.STUDENT,
      status: UserStatus.PENDING,
    });

    try {
      await guard.canActivate(context('student-1'));
      throw new Error('expected pending');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(422);
      expect((error as HttpException).getResponse()).toBe('PENDING');
    }
  });

  it('allows an active student', async () => {
    users.getUserDetails.mockResolvedValue({
      role: Role.STUDENT,
      status: UserStatus.ACTIVE,
    });

    await expect(guard.canActivate(context('student-1'))).resolves.toBe(true);
  });

  it('allows a teacher', async () => {
    users.getUserDetails.mockResolvedValue({
      role: Role.TEACHER,
      status: UserStatus.ACTIVE,
    });

    await expect(guard.canActivate(context('teacher-1'))).resolves.toBe(true);
  });
});
