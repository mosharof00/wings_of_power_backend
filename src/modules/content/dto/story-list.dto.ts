import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AgeGroup } from 'prisma/generated/client';
import { PaginationDto } from '../../../common/pagination/dto/offset-pagination.dto';

export class StudentStoryQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'StoryTheme id' })
  @IsOptional()
  @IsString()
  themeId?: string;

  @ApiPropertyOptional({
    description: 'Legacy theme slug filter (e.g. kindness). Prefer themeId.',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ enum: AgeGroup })
  @IsOptional()
  @IsEnum(AgeGroup)
  ageGroup?: AgeGroup;

  @ApiPropertyOptional({ description: 'Case-insensitive title contains' })
  @IsOptional()
  @IsString()
  search?: string;
}
