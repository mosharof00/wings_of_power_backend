import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { UserType } from 'prisma/generated';

export class CreateUserResDto {
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ example: '019948547647' })
  @ApiProperty()
  phone_number?: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @MinLength(8, { message: 'Password should be minimum 8 characters' })
  password: string;

  @ApiPropertyOptional({
    enum: UserType,
    default: UserType.SEEKER,
  })
  @ApiProperty({ example: UserType.SEEKER })
  @IsOptional()
  @IsEnum(UserType)
  type?: UserType;
}

export class LoginUserResDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @MinLength(8, { message: 'Password should be minimum 8 characters' })
  password: string;

  @ApiProperty({ example: 'fcm-token' })
  @IsString()
  fcm_token: string;
}
export class ForgotPasswordDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;
}

export class VerifyTokenDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '156545' })
  @IsString()
  token: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @MinLength(8, { message: 'Password should be minimum 8 characters' })
  old_password: string;

  @ApiProperty({ example: 'password123' })
  @MinLength(8, { message: 'Password should be minimum 8 characters' })
  new_password: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  token: string;

  @ApiProperty({ example: 'password123' })
  @MinLength(8, { message: 'Password should be minimum 8 characters' })
  password: string;
}

export class UpdateUserResDto {
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'John' })
  @IsOptional()
  phone_number?: string;

  @ApiPropertyOptional({
    example: 'image.jpg',
    type: 'string',
    format: 'binary',
  })
  @IsOptional()
  image?: string;
}

export class VolunteerListResDto {
  @ApiProperty({ example: 'uuid-string' })
  id: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: 'john@example.com' })
  email: string;

  @ApiProperty({
    enum: UserType,
    example: UserType.VOLUNTEER,
  })
  type: UserType;

  @ApiProperty({ example: '2023-10-27T10:00:00.000Z' })
  created_at: Date;
}
