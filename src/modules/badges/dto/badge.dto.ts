import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { BadgeCode } from 'prisma/generated/client';
import { PaginationDto } from '../../../common/pagination/dto/offset-pagination.dto';

export class TeacherBadgeMonitorQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by specific class ID' })
  @IsOptional()
  @IsString()
  classId?: string;
}

export class BadgeCriteriaDto {
  @ApiPropertyOptional({ description: 'Number of completed stories required' })
  @IsOptional()
  @IsInt()
  @Min(0)
  stories_completed?: number;

  @ApiPropertyOptional({ description: 'Number of completed chapters required' })
  @IsOptional()
  @IsInt()
  @Min(0)
  chapters_completed?: number;

  @ApiPropertyOptional({
    description: 'Mean of best quiz percentages required (0-100)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  quiz_best_mean?: number;

  @ApiPropertyOptional({ description: 'Total kindness points required' })
  @IsOptional()
  @IsInt()
  @Min(0)
  kindness_points?: number;

  @ApiPropertyOptional({ description: 'Count of teacher award rows required' })
  @IsOptional()
  @IsInt()
  @Min(0)
  teacher_awards?: number;

  @ApiPropertyOptional({
    description: 'Optional bonus points awarded on earning',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  bonus_points?: number;
}

export class UpdateBadgeItemDto {
  @ApiPropertyOptional({ description: 'Badge ID' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({ enum: BadgeCode, description: 'Badge code' })
  @IsOptional()
  @IsEnum(BadgeCode)
  code?: BadgeCode;

  @ApiPropertyOptional({ description: 'Badge title' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Badge description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'How to earn description' })
  @IsOptional()
  @IsString()
  how_to_earn?: string;

  @ApiPropertyOptional({
    description: 'How to earn description (camelCase alias)',
  })
  @IsOptional()
  @IsString()
  howToEarn?: string;

  @ApiPropertyOptional({ description: 'Badge art URL' })
  @IsOptional()
  @IsString()
  art_url?: string;

  @ApiPropertyOptional({ description: 'Badge art URL (camelCase alias)' })
  @IsOptional()
  @IsString()
  artUrl?: string;

  @ApiPropertyOptional({ description: 'Criteria JSON object' })
  @IsOptional()
  criteria_json?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Criteria JSON object (camelCase alias)',
  })
  @IsOptional()
  criteriaJson?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Numeric threshold shorthand' })
  @IsOptional()
  @IsNumber()
  threshold?: number;
}

export class PatchBadgesDto {
  @ApiPropertyOptional({
    type: [UpdateBadgeItemDto],
    description: 'List of badges to update',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateBadgeItemDto)
  badges?: UpdateBadgeItemDto[];

  @ApiPropertyOptional({ description: 'Badge ID for single badge update' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({ enum: BadgeCode, description: 'Badge code' })
  @IsOptional()
  @IsEnum(BadgeCode)
  code?: BadgeCode;

  @ApiPropertyOptional({ description: 'Badge title' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Badge description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'How to earn description' })
  @IsOptional()
  @IsString()
  how_to_earn?: string;

  @ApiPropertyOptional({
    description: 'How to earn description (camelCase alias)',
  })
  @IsOptional()
  @IsString()
  howToEarn?: string;

  @ApiPropertyOptional({ description: 'Badge art URL' })
  @IsOptional()
  @IsString()
  art_url?: string;

  @ApiPropertyOptional({ description: 'Badge art URL (camelCase alias)' })
  @IsOptional()
  @IsString()
  artUrl?: string;

  @ApiPropertyOptional({ description: 'Criteria JSON object' })
  @IsOptional()
  criteria_json?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Criteria JSON object (camelCase alias)',
  })
  @IsOptional()
  criteriaJson?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Numeric threshold shorthand' })
  @IsOptional()
  @IsNumber()
  threshold?: number;
}
