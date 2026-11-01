import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRepository } from '../../../common/repository/user/user.repository';
import { Role } from './role.enum';
import { RolesGuard } from './roles.guard';

function context(user?: { userId: string }): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const users = { getUserDetails: jest.fn() };
  const guard = new RolesGuard(
    reflector as unknown as Reflector,
    users as unknown as UserRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows a user whose role matches', async () => {
    reflector.getAllAndOverride.mockReturnValue([Role.TEACHER]);
    users.getUserDetails.mockResolvedValue({ role: Role.TEACHER });

    await expect(
      guard.canActivate(context({ userId: 'user-1' })),
    ).resolves.toBe(true);
  });

  it('rejects a different role with 403', async () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);
    users.getUserDetails.mockResolvedValue({ role: Role.TEACHER });

    try {
      await guard.canActivate(context({ userId: 'user-1' }));
      throw new Error('expected forbidden');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(403);
    }
  });

  it('rejects a missing user with 401', async () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);
    users.getUserDetails.mockResolvedValue(null);

    try {
      await guard.canActivate(context({ userId: 'missing' }));
      throw new Error('expected unauthorized');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(401);
    }
  });
});
