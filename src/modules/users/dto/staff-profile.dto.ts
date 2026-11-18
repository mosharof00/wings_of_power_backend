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
  @ApiPropertyOptional({ description: 'Match name, handle, or email' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class InviteStaffDto {
  @ApiProperty({ example: 'Jonah Levy' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ example: 'teacher@school.edu' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'TempPass1!', minLength: 8 })
  @IsString()
  @MinLength(8)
  temporaryPassword: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  canAccessSafeSpace: boolean;

  @ApiPropertyOptional({
    description: 'Optional class id to assign as teacher',
    example: 'class-id',
  })
  @IsOptional()
  @IsString()
  assignedClass?: string;
}

export class UpdateStaffDto {
  @ApiProperty({ example: 'Jonah Levy' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional({ example: 'teacher@school.edu' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  canAccessSafeSpace?: boolean;

  @ApiPropertyOptional({
    description: 'Class id or class name to assign as teacher',
  })
  @IsOptional()
  @IsString()
  assignedClass?: string;
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
