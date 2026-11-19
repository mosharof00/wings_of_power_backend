import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AgeGroup, PublishStatus } from 'prisma/generated/client';
import { PaginationDto } from '../../../common/pagination/dto/offset-pagination.dto';

export class StoryListQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: PublishStatus })
  @IsOptional()
  @IsEnum(PublishStatus)
  status?: PublishStatus;

  @ApiPropertyOptional({ enum: AgeGroup })
  @IsOptional()
  @IsEnum(AgeGroup)
  ageGroup?: AgeGroup;

  @ApiPropertyOptional({ description: 'Case-insensitive title contains' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Alias for search (dashboard uses q)' })
  @IsOptional()
  @IsString()
  q?: string;
}

export class CreateStoryDto {
  @ApiProperty({ example: 'The Kindness Bridge' })
  @IsString()
  @MinLength(1)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  synopsis?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  coverUrl?: string;

  @ApiProperty({ description: 'StoryTheme id (D59)' })
  @IsString()
  @MinLength(1)
  themeId: string;

  @ApiProperty({ enum: AgeGroup, description: 'AGE_6_9, AGE_10_13, or ADULTS' })
  @IsEnum(AgeGroup)
  ageGroup: AgeGroup;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  estimatedMinutes?: number;
}

export class UpdateStoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  synopsis?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  coverUrl?: string;

  @ApiPropertyOptional({ description: 'StoryTheme id (D59)' })
  @IsOptional()
  @IsString()
  themeId?: string;

  @ApiPropertyOptional({ enum: AgeGroup })
  @IsOptional()
  @IsEnum(AgeGroup)
  ageGroup?: AgeGroup;

  @ApiPropertyOptional({ enum: PublishStatus })
  @IsOptional()
  @IsEnum(PublishStatus)
  status?: PublishStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  estimatedMinutes?: number;
}

export class CreateChapterDto {
  @ApiProperty({ example: 'Chapter 1' })
  @IsString()
  @MinLength(1)
  title: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  number?: number;
}

export class PageInputDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  number: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bodyText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;
}

export class PutPagesDto {
  @ApiProperty({ type: [PageInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PageInputDto)
  pages: PageInputDto[];
}

export class PutAudioDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  audioUrl: string;

  @ApiPropertyOptional({ example: 180000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationMs?: number;
}
