import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/pagination/dto/offset-pagination.dto';

export enum LeaderboardScope {
  CLASS = 'class',
  SCHOOL = 'school',
}

export class LeaderboardQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: LeaderboardScope,
    default: LeaderboardScope.CLASS,
    description: 'Leaderboard scope: class or school',
  })
  @IsOptional()
  @IsEnum(LeaderboardScope, {
    message: 'Invalid scope: must be class or school',
  })
  scope?: LeaderboardScope = LeaderboardScope.CLASS;
}

export interface LeaderboardItem {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  kindnessPoints: number;
  rank: number;
}
