import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { MediaType, PublishStatus } from 'prisma/generated/client';
import { PaginationDto } from '../../../common/pagination/dto/offset-pagination.dto';

export class KindnessListQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: PublishStatus })
  @IsOptional()
  @IsEnum(PublishStatus)
  status?: PublishStatus;

  @ApiPropertyOptional({ description: 'Filter by title search query' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreateKindnessItemDto {
  @ApiProperty({ example: 'Helping Hands' })
  @IsString()
  @MinLength(1)
  title: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/media.jpg' })
  @ValidateIf((o) => !o.mediaUrl)
  @IsString()
  @IsNotEmpty({ message: 'media_url is required' })
  media_url?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/media.jpg' })
  @ValidateIf((o) => !o.media_url)
  @IsString()
  @IsNotEmpty({ message: 'mediaUrl is required' })
  mediaUrl?: string;

  @ApiPropertyOptional({ enum: MediaType, example: MediaType.IMAGE })
  @ValidateIf((o) => !o.mediaType)
  @IsEnum(MediaType, { message: 'media_type must be either IMAGE or VIDEO' })
  media_type?: MediaType;

  @ApiPropertyOptional({ enum: MediaType, example: MediaType.IMAGE })
  @ValidateIf((o) => !o.media_type)
  @IsEnum(MediaType, { message: 'mediaType must be either IMAGE or VIDEO' })
  mediaType?: MediaType;

  @ApiPropertyOptional({ enum: PublishStatus, default: PublishStatus.DRAFT })
  @IsOptional()
  @IsEnum(PublishStatus)
  status?: PublishStatus;
}

export class UpdateKindnessItemDto {
  @ApiPropertyOptional({ example: 'Updated Title' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/new-media.jpg' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  media_url?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/new-media.jpg' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  mediaUrl?: string;

  @ApiPropertyOptional({ enum: MediaType, example: MediaType.IMAGE })
  @IsOptional()
  @IsEnum(MediaType, { message: 'media_type must be either IMAGE or VIDEO' })
  media_type?: MediaType;

  @ApiPropertyOptional({ enum: MediaType, example: MediaType.IMAGE })
  @ValidateIf((o) => !o.media_type)
  @IsEnum(MediaType, { message: 'mediaType must be either IMAGE or VIDEO' })
  mediaType?: MediaType;

  @ApiPropertyOptional({ enum: PublishStatus })
  @IsOptional()
  @IsEnum(PublishStatus)
  status?: PublishStatus;
}
