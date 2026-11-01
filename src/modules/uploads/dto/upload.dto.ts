import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export enum UploadPurpose {
  STORY_COVER = 'STORY_COVER',
  PAGE_IMAGE = 'PAGE_IMAGE',
  CHAPTER_AUDIO = 'CHAPTER_AUDIO',
  BADGE_ART = 'BADGE_ART',
  HERO_ART = 'HERO_ART',
  KINDNESS_MEDIA = 'KINDNESS_MEDIA',
}

export class UploadDto {
  @ApiProperty({ enum: UploadPurpose })
  @IsEnum(UploadPurpose)
  purpose: UploadPurpose;
}
