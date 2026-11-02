import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { MatchMode, MatchPhase } from 'prisma/generated/client';

export class JoinQueueDto {
  @ApiProperty({
    description: 'Game mode: SINGLE, ONE_V_ONE, or FIVE_V_FIVE',
    enum: MatchMode,
  })
  @IsNotEmpty()
  @IsEnum(MatchMode)
  mode: MatchMode;

  @ApiPropertyOptional({
    description: 'Optional fixture code for test/dev lobbies',
  })
  @IsOptional()
  @IsString()
  fixtureCode?: string;
}

export class AdminMatchQueryDto {
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

  @ApiPropertyOptional({ enum: MatchMode })
  @IsOptional()
  @IsEnum(MatchMode)
  mode?: MatchMode;

  @ApiPropertyOptional({ enum: MatchPhase })
  @IsOptional()
  @IsEnum(MatchPhase)
  phase?: MatchPhase;
}

export class UpdateEligibilityConfigDto {
  @ApiPropertyOptional({
    description: 'Stories required for game show eligibility',
    example: 2,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  requiredStories?: number;

  @ApiPropertyOptional({
    description: 'Chapters required for game show eligibility',
    example: 6,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  requiredChapters?: number;

  @ApiPropertyOptional({
    description: 'Minimum mean chapter-quiz percentage required',
    example: 70,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minQuizPercent?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  required_stories?: number;

  @ApiPropertyOptional({ example: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  required_chapters?: number;

  @ApiPropertyOptional({ example: 70 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  min_quiz_percent?: number;
}
