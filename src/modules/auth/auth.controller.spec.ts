import { ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

const mockAuthService = {
  me: jest.fn().mockResolvedValue({
    success: true,
    data: { id: 'user-1', role: 'ADMIN', status: 'ACTIVE' },
  }),
  logout: jest.fn().mockReturnValue({ success: true }),
};

const mockJwtAuthGuard = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    req.user = { userId: 'user-1' };
    return true;
  },
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns the current user from the service', async () => {
    const result = await controller.me('user-1');
    expect(mockAuthService.me).toHaveBeenCalledWith('user-1');
    expect(result.data.role).toBe('ADMIN');
  });

  it('logout returns success without revoking a token', () => {
    expect(controller.logout()).toEqual({ success: true });
  });
});
