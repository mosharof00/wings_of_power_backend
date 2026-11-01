import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { PaginationDto } from '../../../common/pagination/dto/offset-pagination.dto';

export class PointsQueryDto extends PaginationDto {}

export class AwardPointsDto {
  @ApiProperty({ description: 'ID of the student receiving points' })
  @IsNotEmpty()
  @IsString()
  studentId: string;

  @ApiProperty({ description: 'Number of points to award (positive integer)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount: number;

  @ApiProperty({ description: 'Award category/label' })
  @IsNotEmpty()
  @IsString()
  category: string;

  @ApiPropertyOptional({ description: 'Reason for awarding points' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class PatchPointRulesDto {
  @ApiPropertyOptional({ description: 'Positive points per story question' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  STORY_QUESTION?: number;

  @ApiPropertyOptional({ description: 'Kindness points per defense round' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  KINDNESS_ROUND?: number;

  @ApiPropertyOptional({ description: 'Maximum teacher award points' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  TEACHER_AWARD_MAX?: number;

  @ApiPropertyOptional({ description: 'Alias for STORY_QUESTION' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  storyPoints?: number;

  @ApiPropertyOptional({ description: 'Alias for KINDNESS_ROUND' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  kindnessPoints?: number;

  @ApiPropertyOptional({ description: 'Alias for TEACHER_AWARD_MAX' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  teacherAward?: number;
}
