import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ReportCategory, ReportStatus } from 'prisma/generated/client';

export class CreateReportDto {
  @ApiProperty({
    enum: ReportCategory,
    description: 'Report category',
    example: ReportCategory.HURTFUL_WORDS,
  })
  @IsEnum(ReportCategory)
  category: ReportCategory;

  @ApiProperty({
    maxLength: 200,
    description: 'Report body text up to 200 characters',
    example: 'Someone said hurtful things to me during recess.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  body: string;

  @ApiPropertyOptional({
    description: 'Whether student feels safe currently',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  feelSafe?: boolean;

  @ApiPropertyOptional({
    description: 'Snake case alias for feelSafe',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  feel_safe?: boolean;
}

export class ReportQueryDto {
  @ApiPropertyOptional({
    enum: ReportStatus,
    description: 'Filter reports by status',
    example: ReportStatus.NEW,
  })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional({
    default: 1,
    description: 'Page number',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    default: 10,
    description: 'Items per page',
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perPage?: number;
}

export class CreateVisitDto {
  @ApiPropertyOptional({
    description: 'Optional live match ID associated with calm room visit',
    example: 'match_123',
  })
  @IsOptional()
  @IsString()
  matchId?: string;

  @ApiPropertyOptional({
    description: 'Optional live match ID (snake_case alias)',
    example: 'match_123',
  })
  @IsOptional()
  @IsString()
  match_id?: string;
}

