import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { AgeGroup, PublishStatus, QuestionType } from 'prisma/generated/client';

export class PackQuestionInputDto {
  @ApiPropertyOptional({
    description:
      'Round type: Q1_WARMUP, Q2_DEFENSE, Q3_HOBBY, Q4_FINALS (or Q1-Q4)',
    example: 'Q1_WARMUP',
  })
  @IsOptional()
  @IsString()
  roundType?: string;

  @ApiPropertyOptional({
    description: 'Snake case alternative for roundType',
    example: 'Q1_WARMUP',
  })
  @IsOptional()
  @IsString()
  round_type?: string;

  @ApiPropertyOptional({
    description: 'Sort order within the round',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({
    description: 'Snake case alternative for sortOrder',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort_order?: number;

  @ApiPropertyOptional({
    enum: QuestionType,
    default: QuestionType.MCQ,
  })
  @IsOptional()
  @IsEnum(QuestionType)
  type?: QuestionType;

  @ApiProperty({
    description: 'Question prompt',
    example: 'What is the best way to support a friend being bullied?',
  })
  @IsNotEmpty()
  @IsString()
  prompt: string;

  @ApiPropertyOptional({
    description: 'JSON object with options array and correctIndex',
    example: { options: ['Option A', 'Option B'], correctIndex: 0 },
  })
  @IsOptional()
  optionsJson?: any;

  @ApiPropertyOptional({
    description: 'Snake case alternative for optionsJson',
    example: { options: ['Option A', 'Option B'], correctIndex: 0 },
  })
  @IsOptional()
  options_json?: any;

  @ApiPropertyOptional({
    description: 'Direct options list if not using optionsJson',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  options?: string[];

  @ApiPropertyOptional({
    description: 'Correct option index if not using optionsJson',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  correctIndex?: number;

  @ApiPropertyOptional({
    description: 'Optional metadata JSON',
  })
  @IsOptional()
  metaJson?: any;

  @ApiPropertyOptional({
    description: 'Snake case alternative for metaJson',
  })
  @IsOptional()
  meta_json?: any;
}

export class CreatePackDto {
  @ApiProperty({
    description: 'Pack title',
    example: 'Anti-bullying Awareness Week Pack',
  })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiPropertyOptional({
    enum: AgeGroup,
    description: 'Age group: AGE_6_9, AGE_10_13, or ADULTS',
  })
  @IsOptional()
  ageGroup?: string;

  @ApiPropertyOptional({
    enum: AgeGroup,
    description: 'Snake case alternative for ageGroup',
  })
  @IsOptional()
  age_group?: string;

  @ApiPropertyOptional({
    enum: PublishStatus,
    default: PublishStatus.DRAFT,
  })
  @IsOptional()
  status?: PublishStatus;

  @ApiPropertyOptional({
    description: 'Story IDs linked to this pack',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  storyIds?: string[];

  @ApiPropertyOptional({
    description: 'Snake case alternative for storyIds',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  story_ids?: string[];

  @ApiPropertyOptional({
    description: 'List of questions for the pack',
    type: [PackQuestionInputDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackQuestionInputDto)
  questions?: PackQuestionInputDto[];

  @ApiPropertyOptional({
    description: 'School ID (admin only when admin has no school_id)',
  })
  @IsOptional()
  @IsString()
  schoolId?: string;

  @ApiPropertyOptional({
    description: 'Snake case alternative for schoolId',
  })
  @IsOptional()
  @IsString()
  school_id?: string;
}

export class UpdatePackDto {
  @ApiPropertyOptional({
    description: 'Pack title',
    example: 'Updated Pack Title',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    enum: AgeGroup,
    description: 'Age group: AGE_6_9, AGE_10_13, or ADULTS',
  })
  @IsOptional()
  ageGroup?: string;

  @ApiPropertyOptional({
    enum: AgeGroup,
    description: 'Snake case alternative for ageGroup',
  })
  @IsOptional()
  age_group?: string;

  @ApiPropertyOptional({
    enum: PublishStatus,
  })
  @IsOptional()
  status?: PublishStatus;

  @ApiPropertyOptional({
    description: 'Story IDs linked to this pack',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  storyIds?: string[];

  @ApiPropertyOptional({
    description: 'Snake case alternative for storyIds',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  story_ids?: string[];

  @ApiPropertyOptional({
    description: 'List of questions for the pack',
    type: [PackQuestionInputDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackQuestionInputDto)
  questions?: PackQuestionInputDto[];
}

export class PackListQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perPage?: number = 10;

  @ApiPropertyOptional({ enum: PublishStatus })
  @IsOptional()
  status?: PublishStatus;

  @ApiPropertyOptional({ enum: AgeGroup })
  @IsOptional()
  ageGroup?: string;

  @ApiPropertyOptional({ enum: AgeGroup })
  @IsOptional()
  age_group?: string;

  @ApiPropertyOptional({ description: 'Search term for pack title' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Search term alias' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'School ID filter for admin' })
  @IsOptional()
  @IsString()
  schoolId?: string;

  @ApiPropertyOptional({ description: 'Snake case alternative for schoolId' })
  @IsOptional()
  @IsString()
  school_id?: string;
}
