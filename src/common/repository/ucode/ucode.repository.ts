import { randomInt, randomBytes } from 'crypto';
import { v4 as uuid } from 'uuid';
import { DateHelper } from '../../helper/date.helper';
import { UserRepository } from '../user/user.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class UcodeRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userRepository: UserRepository,
  ) {}

  /**
   * create ucode token
   * @param userId - user id
   * @param isOtp - if true, generate 6 digit OTP
   * @param email - optional email (uses user's email if not provided)
   * @param time - expiry time in minutes (default 5 minutes)
   * @returns
   */
  async createToken({
    userId,
    isOtp = false,
    email = null,
    time = 5,
  }: {
    userId: string;
    isOtp?: boolean;
    email?: string;
    time?: number;
  }): Promise<string> {
    const otpExpiryTime = time * 60 * 1000;

    const expired_at = new Date(Date.now() + otpExpiryTime);

    const userDetails = await this.userRepository.getUserDetails(userId);

    if (userDetails && userDetails.email) {
      const targetEmail = email ?? userDetails.email;

      await this.prisma.ucode.deleteMany({
        where: {
          email: targetEmail,
        },
      });

      let token: string;
      if (isOtp) {
        token = String(randomInt(100000, 1000000));
      } else {
        token = uuid();
      }
      const data = await this.prisma.ucode.create({
        data: {
          user_id: userId,
          token: token,
          email: targetEmail,
          expired_at: expired_at,
        },
      });
      return data.token;
    } else {
      return null;
    }
  }

  /**
   * validate ucode token
   * @param email - email address
   * @param token - OTP/token to validate
   * @param forEmailChange - if true, skip user existence check
   * @returns true if valid, false if invalid or expired
   */
  async validateToken({
    email,
    token,
    forEmailChange = false,
  }: {
    email: string;
    token: string;
    forEmailChange?: boolean;
  }) {
    if (!forEmailChange) {
      const userDetails = await this.userRepository.exist({
        field: 'email',
        value: email,
      });
      if (!userDetails || !userDetails.email) {
        return false;
      }
    }

    // Find the token
    const existToken = await this.prisma.ucode.findFirst({
      where: {
        token: token,
        email: email,
      },
    });

    // Token not found
    if (!existToken) {
      return false;
    }

    // Check if token is expired
    if (existToken.expired_at) {
      const now = new Date();
      if (existToken.expired_at < now) {
        // Token expired - delete it
        await this.prisma.ucode.delete({
          where: { id: existToken.id },
        });
        return false;
      }
    }

    // Token is valid - delete it after successful validation
    await this.prisma.ucode.delete({
      where: { id: existToken.id },
    });

    return true;
  }

  /**
   * verify ucode token
   * @returns { success: boolean, message: string }
   */
  async verifyToken({ email, token }: { email: string; token: string }) {
    const updatedToken = await this.prisma.ucode.updateMany({
      where: {
        token: token,
        email: email,
        verified_at: null,
      },
      data: { verified_at: new Date() },
    });

    if (updatedToken.count === 0) {
      const existToken = await this.prisma.ucode.findFirst({
        where: {
          token: token,
          email: email,
        },
      });

      if (!existToken) {
        return {
          success: false,
          message: 'Invalid token',
        };
      }

      if (existToken.verified_at) {
        return {
          success: false,
          message: 'Token already verified',
        };
      }

      if (existToken.expired_at && existToken.expired_at < new Date()) {
        await this.prisma.ucode.delete({
          where: { id: existToken.id },
        });
        return {
          success: false,
          message: 'Token expired',
        };
      }

      return {
        success: false,
        message: 'Invalid token',
      };
    }

    // Token was successfully verified, now check if it was expired
    const verifiedToken = await this.prisma.ucode.findFirst({
      where: {
        token: token,
        email: email,
      },
    });

    // Check if token was expired (updateMany doesn't check expiry)
    if (verifiedToken?.expired_at && verifiedToken.expired_at < new Date()) {
      await this.prisma.ucode.delete({
        where: { id: verifiedToken.id },
      });
      return {
        success: false,
        message: 'Token expired',
      };
    }

    return {
      success: true,
      message: 'Token verified successfully',
    };
  }

  /**
   * Check if token is verified
   * @returns boolean - true if verified, false otherwise
   */
  async verifycheckToken({ email, token }: { email: string; token: string }) {
    const existToken = await this.prisma.ucode.findFirst({
      where: {
        token: token,
        email: email,
      },
    });

    if (!existToken) {
      return false;
    }

    if (existToken.verified_at) {
      return true;
    }

    return false;
  }

  /**
   * delete ucode token
   * @returns
   */
  async deleteToken({ email, token }) {
    await this.prisma.ucode.deleteMany({
      where: {
        AND: [{ email: email }, { token: token }],
      },
    });
  }

  async createVerificationToken(params: { userId: string; email: string }) {
    try {
      const token = randomBytes(32).toString('hex');

      const ucode = await this.prisma.ucode.create({
        data: {
          user_id: params.userId,
          email: params.email,
          token: token,
          expired_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
          status: 1,
        },
      });

      return ucode;
    } catch (error) {
      return null;
    }
  }
}
