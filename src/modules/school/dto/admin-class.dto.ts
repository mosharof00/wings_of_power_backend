import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { AgeGroup } from 'prisma/generated/client';

export class CreateClassDto {
  @ApiProperty({ example: 'Grade 4 · Amber' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ example: 'Grade 4' })
  @IsString()
  @MinLength(1)
  grade: string;

  @ApiProperty({ enum: AgeGroup, example: AgeGroup.AGE_6_9 })
  @IsEnum(AgeGroup)
  ageGroup: AgeGroup;

  @ApiProperty({ example: 'teacher-id' })
  @IsString()
  @MinLength(1)
  teacherId: string;
}

export class ChangeTeacherDto {
  @ApiProperty({ example: 'teacher-id' })
  @IsString()
  @MinLength(1)
  teacherId: string;
}

export class CreateClassRequestDto {
  @ApiProperty({ example: 'Grade 5 · Birch' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ example: 'Grade 5' })
  @IsString()
  @MinLength(1)
  grade: string;

  @ApiProperty({ enum: AgeGroup, example: AgeGroup.AGE_10_13 })
  @IsEnum(AgeGroup)
  ageGroup: AgeGroup;
}

export class CodeRenewalDto {
  @ApiPropertyOptional({ example: 'The posted code expired' })
  @IsOptional()
  @IsString()
  reason?: string;
}
