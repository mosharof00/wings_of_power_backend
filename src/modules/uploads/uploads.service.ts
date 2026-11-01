import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { TajulStorage } from '../../common/lib/Disk/TajulStorage';
import { UploadPurpose } from './dto/upload.dto';

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AUDIO_MIME = new Set(['audio/mpeg', 'audio/mp4', 'audio/aac']);
const IMAGE_LIMIT = 5 * 1024 * 1024;
const AUDIO_LIMIT = 20 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
};

const FOLDERS: Record<UploadPurpose, string> = {
  [UploadPurpose.STORY_COVER]: 'story-cover',
  [UploadPurpose.PAGE_IMAGE]: 'page-image',
  [UploadPurpose.CHAPTER_AUDIO]: 'chapter-audio',
  [UploadPurpose.BADGE_ART]: 'badge-art',
  [UploadPurpose.HERO_ART]: 'hero-art',
  [UploadPurpose.KINDNESS_MEDIA]: 'kindness-media',
};

export type UploadFile = {
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@Injectable()
export class UploadsService {
  async upload(file: UploadFile | undefined, purpose: UploadPurpose) {
    if (!file?.buffer?.length) {
      throw new HttpException('File is required', HttpStatus.BAD_REQUEST);
    }

    const audio = purpose === UploadPurpose.CHAPTER_AUDIO;
    const allowed = audio ? AUDIO_MIME : IMAGE_MIME;
    if (!allowed.has(file.mimetype)) {
      throw new HttpException(
        'File type is not allowed',
        HttpStatus.BAD_REQUEST,
      );
    }

    const limit = audio ? AUDIO_LIMIT : IMAGE_LIMIT;
    if (file.size > limit) {
      throw new HttpException('File is too large', HttpStatus.BAD_REQUEST);
    }

    const key = `${FOLDERS[purpose]}/${randomUUID()}${EXTENSIONS[file.mimetype]}`;
    await TajulStorage.put(key, file.buffer);
    return {
      success: true,
      data: {
        url: TajulStorage.url(key),
        key,
        mime: file.mimetype,
        size: file.size,
      },
    };
  }
}
