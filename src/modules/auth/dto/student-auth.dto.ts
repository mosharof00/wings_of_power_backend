import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class JoinCodeDto {
  @ApiProperty({ example: 'WING-4320' })
  @IsString()
  @MinLength(1)
  code: string;
}

export class RegisterStudentDto {
  @ApiProperty({ example: 'WING-4320' })
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
