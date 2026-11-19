import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ReadingMode } from 'prisma/generated/client';

export class PageReadDto {
  @ApiProperty()
  @IsString()
  storyId: string;

  @ApiProperty()
  @IsString()
  chapterId: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageNumber: number;

  @ApiProperty({ enum: ReadingMode })
  @IsEnum(ReadingMode)
  mode: ReadingMode;

  @ApiPropertyOptional({ description: 'Seconds the page stayed open (READ)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dwellSeconds?: number;

  @ApiPropertyOptional({
    description: 'Listen progress percent for this page segment (0-100)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  listenPercent?: number;
}

export class PutProgressDto {
  @ApiPropertyOptional({ description: 'Chapter ID' })
  @IsOptional()
  @IsString()
  chapterId?: string;

  @ApiPropertyOptional({ description: 'Chapter ID (snake_case)' })
  @IsOptional()
  @IsString()
  chapter_id?: string;

  @ApiPropertyOptional({ description: 'Page number' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  pageNumber?: number;

  @ApiPropertyOptional({ description: 'Page number (snake_case)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page_number?: number;

  @ApiProperty({ description: 'Percent complete (0-100)' })
  @Type(() => Number)
  @IsInt()
  percent: number;

  @ApiPropertyOptional({ enum: ReadingMode, description: 'Last reading mode' })
  @IsOptional()
  @IsEnum(ReadingMode)
  lastMode?: ReadingMode;

  @ApiPropertyOptional({
    enum: ReadingMode,
    description: 'Last reading mode (snake_case)',
  })
  @IsOptional()
  @IsEnum(ReadingMode)
  last_mode?: ReadingMode;

  @ApiPropertyOptional({ enum: ReadingMode, description: 'Reading mode alias' })
  @IsOptional()
  @IsEnum(ReadingMode)
  mode?: ReadingMode;
}
