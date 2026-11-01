import { Injectable } from '@nestjs/common';
import { Prisma } from 'prisma/generated/client';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findFirst({
      where: { id },
    });
  }

  findByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email },
    });
  }

  findByUsername(username: string) {
    return this.prisma.user.findFirst({
      where: { username },
    });
  }

  /**
   * Lookup used by the existing guards. Same row as findById.
   */
  getUserDetails(userId: string) {
    return this.findById(userId);
  }

  create(data: Prisma.UserCreateInput) {
    return this.prisma.user.create({ data });
  }

  updatePasswordHash(id: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id },
      data: { password_hash: passwordHash },
    });
  }
}
