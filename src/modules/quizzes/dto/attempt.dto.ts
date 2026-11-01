import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SubmitAnswerDto {
  @ApiPropertyOptional({ description: 'Question ID' })
  @IsOptional()
  @IsString()
  questionId?: string;

  @ApiPropertyOptional({ description: 'Question ID (snake_case)' })
  @IsOptional()
  @IsString()
  question_id?: string;

  @ApiPropertyOptional({ description: 'Option ID' })
  @IsOptional()
  @IsString()
  optionId?: string;

  @ApiPropertyOptional({ description: 'Option ID (snake_case)' })
  @IsOptional()
  @IsString()
  option_id?: string;

  @ApiPropertyOptional({ description: 'Free-text answer' })
  @IsOptional()
  @IsString()
  freeText?: string;

  @ApiPropertyOptional({ description: 'Free-text answer (snake_case)' })
  @IsOptional()
  @IsString()
  free_text?: string;
}
