import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { QuestionType } from 'prisma/generated/client';

export class QuizOptionDto {
  @ApiProperty({ example: 'Tell a teacher' })
  @IsString()
  @MinLength(1)
  label: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isCorrect?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_correct?: boolean;
}

export class QuizQuestionDto {
  @ApiProperty({ enum: QuestionType })
  @IsEnum(QuestionType)
  type: QuestionType;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  prompt: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hint?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  explanation?: string;

  @ApiPropertyOptional({ type: [QuizOptionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuizOptionDto)
  options?: QuizOptionDto[];
}

export class CheckpointQuizDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ type: [QuizQuestionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuizQuestionDto)
  questions: QuizQuestionDto[];
}

export class UpsertQuizDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ type: [QuizQuestionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuizQuestionDto)
  questions: QuizQuestionDto[];

  @ApiPropertyOptional({ type: CheckpointQuizDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CheckpointQuizDto)
  checkpoint?: CheckpointQuizDto;
}
