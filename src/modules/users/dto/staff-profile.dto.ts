import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { UserStatus } from 'prisma/generated/client';
import { PaginationDto } from '../../../common/pagination/dto/offset-pagination.dto';

export class StaffListQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class InviteStaffDto {
  @ApiProperty({ example: 'teacher@school.edu' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  canAccessSafeSpace: boolean;
}

export class UpdateStaffDto {
  @ApiProperty({ example: 'Jonah Levy' })
  @IsString()
  @MinLength(1)
  realName: string;
}

export class UpdateTeacherProfileDto {
  @ApiPropertyOptional({ example: 'Sarah Mitchell' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  realName?: string;
}

export class UpdateStudentProfileDto {
  @ApiPropertyOptional({ example: 'Sarah' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  nickname?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example/avatar.png' })
  @IsOptional()
  @IsString()
  avatarUrl?: string;
}

export class NotificationSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  stories?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  badges?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  game_show?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  safe_space?: boolean;
}

export class SettingsDto {
  @ApiPropertyOptional({ description: 'Read to Me' })
  @IsOptional()
  @IsBoolean()
  read_to_me?: boolean;

  @ApiPropertyOptional({ description: 'Sound effect' })
  @IsOptional()
  @IsBoolean()
  sound?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationSettingsDto)
  notifications?: NotificationSettingsDto;
}
