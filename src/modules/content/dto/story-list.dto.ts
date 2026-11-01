import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AgeGroup, StoryCategory } from 'prisma/generated/client';
import { PaginationDto } from '../../../common/pagination/dto/offset-pagination.dto';

export class StudentStoryQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: StoryCategory })
  @IsOptional()
  @IsEnum(StoryCategory)
  category?: StoryCategory;

  @ApiPropertyOptional({ enum: AgeGroup })
  @IsOptional()
  @IsEnum(AgeGroup)
  ageGroup?: AgeGroup;

  @ApiPropertyOptional({ description: 'Case-insensitive title contains' })
  @IsOptional()
  @IsString()
  search?: string;
}
