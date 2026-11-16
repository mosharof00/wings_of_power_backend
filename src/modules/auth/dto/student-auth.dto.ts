import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class JoinCodeDto {
  @ApiProperty({ example: '864320' })
  @IsString()
  @MinLength(1)
  code: string;
}

export class CheckUsernameDto {
  @ApiProperty({ example: 'wingkid' })
  @IsString()
  @MinLength(3)
  username: string;
}

export class RegisterStudentDto {
  @ApiProperty({ example: '864320' })
  @IsString()
  @MinLength(1)
  code: string;

  @ApiProperty({ example: 'wingkid' })
  @IsString()
  @MinLength(1)
  username: string;

  @ApiProperty({ example: 'password1', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'password1', minLength: 8 })
  @IsString()
  @MinLength(8)
  confirmPassword: string;

  @ApiProperty({ example: 'Wing' })
  @IsString()
  @MinLength(1)
  nickname: string;

  @ApiProperty({ example: 'Wing Kid' })
  @IsString()
  @MinLength(1)
  realName: string;

  @ApiProperty({ example: 9, minimum: 4, maximum: 99 })
  @Type(() => Number)
  @IsInt()
  @Min(4)
  @Max(99)
  age: number;

  @ApiPropertyOptional({ example: 'assets/images/avatar_01.png' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  avatarUrl?: string;
}

export class StudentLoginDto {
  @ApiProperty({ example: 'wingkid' })
  @IsString()
  @MinLength(1)
  username: string;

  @ApiProperty({ example: 'password1' })
  @IsString()
  @MinLength(1)
  password: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

export class StudentForgotPasswordDto {
  @ApiPropertyOptional({ example: 'wingkid' })
  @IsOptional()
  @IsString()
  username?: string;
}

export class SelectHeroDto {
  @ApiProperty({ example: 'hero-id' })
  @IsString()
  @MinLength(1)
  heroId: string;
}
