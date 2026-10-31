import { ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

const mockAuthService = {
  me: jest.fn().mockResolvedValue({
    success: true,
    data: { id: 1, name: 'Test User' },
  }),
  revokeRefreshToken: jest.fn().mockResolvedValue({ success: true }),
  forgotPassword: jest.fn().mockResolvedValue({ success: true }),
  verifyEmail: jest.fn().mockResolvedValue({ success: true }),
  resetPassword: jest.fn().mockResolvedValue({ success: true }),
  changePassword: jest.fn().mockResolvedValue({ success: true }),
};

const mockUserRequest = {
  user: {
    userId: '1',
    email: 'test@example.com',
  },
};

const mockJwtAuthGuard = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    req.user = mockUserRequest.user;
    return true;
  },
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return current user info', async () => {
    const result = await controller.me({ user: { userId: '1' } } as any);
    expect(result.data.id).toBe(1);
  });

  it('should logout user', async () => {
    const result = await controller.logout({ user: { userId: '1' } } as any);
    expect(result.success).toBe(true);
  });

  it('should handle forgot password', async () => {
    const result = await controller.forgotPassword({
      email: 'john@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('should verify email', async () => {
    const result = await controller.verifyEmail({
      email: 'john@example.com',
      token: '1234',
    });
    expect(result.success).toBe(true);
  });

  it('should reset password', async () => {
    const result = await controller.resetPassword({
      email: 'john@example.com',
      token: '1234',
      password: 'newpass',
    });
    expect(result.success).toBe(true);
  });

  it('should change password', async () => {
    const result = await controller.changePassword(
      { user: { userId: '1' } } as any,
      {
        email: 'john@example.com',
        old_password: 'oldpass',
        new_password: 'newpass',
      },
    );
    expect(result.success).toBe(true);
  });
});
