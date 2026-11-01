import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MinLength } from 'class-validator';

export class RegisterAdminDto {
  @ApiProperty({ example: 'Ada Admin' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ example: 'admin@demo.school' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password1', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'password1', minLength: 8 })
  @IsString()
  @MinLength(8)
  confirmPassword: string;
}

export class VerifyEmailDto {
  @ApiProperty({ example: 'admin@demo.school' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '453210' })
  @IsString()
  @Length(6, 6)
  code: string;
}

export class StaffLoginDto {
  @ApiProperty({ example: 'admin@demo.school' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password1' })
  @IsString()
  @MinLength(1)
  password: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'admin@demo.school' })
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: '453210' })
  @IsString()
  @Length(6, 6)
  token: string;

  @ApiProperty({ example: 'password1', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'password1', minLength: 8 })
  @IsString()
  @MinLength(8)
  confirmPassword: string;
}

export class SchoolProfileDto {
  @ApiProperty({ example: 'Demo Elementary' })
  @IsString()
  @MinLength(1)
  name: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'password1' })
  @IsString()
  @MinLength(1)
  current: string;

  @ApiProperty({ example: 'password2', minLength: 8 })
  @IsString()
  @MinLength(8)
  next: string;
}
