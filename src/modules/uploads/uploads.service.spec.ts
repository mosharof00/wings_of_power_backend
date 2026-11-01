import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRepository } from '../../common/repository/user/user.repository';
import { Role } from '../../common/guard/role/role.enum';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { TajulStorage } from '../../common/lib/Disk/TajulStorage';
import { UploadPurpose } from './dto/upload.dto';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

jest.mock('../../common/lib/Disk/TajulStorage', () => ({
  TajulStorage: {
    put: jest.fn().mockResolvedValue(undefined),
    url: jest.fn((key: string) => `http://localhost/public/storage/${key}`),
  },
}));

describe('UploadsService', () => {
  const service = new UploadsService();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a non-admin with 403', async () => {
    const reflector = new Reflector();
    const users = {
      getUserDetails: jest.fn().mockResolvedValue({ role: Role.TEACHER }),
    };
    const guard = new RolesGuard(reflector, users as unknown as UserRepository);
    const context = {
      getHandler: () => UploadsController.prototype.upload,
      getClass: () => UploadsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: 'teacher-1' } }),
      }),
    } as unknown as ExecutionContext;

    try {
      await guard.canActivate(context);
      throw new Error('expected forbidden');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(403);
    }
    expect(TajulStorage.put).not.toHaveBeenCalled();
  });

  it('rejects a disallowed MIME with 400', async () => {
    await expectStatus(
      service.upload(file('image/gif', 100), UploadPurpose.STORY_COVER),
      400,
    );
    expect(TajulStorage.put).not.toHaveBeenCalled();
  });

  it('rejects an image over 5 MB with 400', async () => {
    await expectStatus(
      service.upload(
        file('image/png', 5 * 1024 * 1024 + 1),
        UploadPurpose.PAGE_IMAGE,
      ),
      400,
    );
    expect(TajulStorage.put).not.toHaveBeenCalled();
  });

  it('stores an allowed png and returns url and key', async () => {
    const result = await service.upload(
      file('image/png', 1200),
      UploadPurpose.STORY_COVER,
    );

    expect(TajulStorage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^story-cover\/[0-9a-f-]+\.png$/),
      expect.any(Buffer),
    );
    expect(result.data.key).toMatch(/^story-cover\/[0-9a-f-]+\.png$/);
    expect(result.data.url).toBe(
      `http://localhost/public/storage/${result.data.key}`,
    );
    expect(result.data.mime).toBe('image/png');
    expect(result.data.size).toBe(1200);
  });

  it('rejects a png for chapter audio', async () => {
    await expectStatus(
      service.upload(file('image/png', 1200), UploadPurpose.CHAPTER_AUDIO),
      400,
    );
    expect(TajulStorage.put).not.toHaveBeenCalled();
  });
});

function file(mimetype: string, size: number) {
  return { mimetype, size, buffer: Buffer.from('file') };
}

async function expectStatus(pending: Promise<unknown>, status: number) {
  try {
    await pending;
    throw new Error(`expected ${status}`);
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
  }
}
