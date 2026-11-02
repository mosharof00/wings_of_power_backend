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
import { ReportStatus } from 'prisma/generated/client';

export class StaffReportQueryDto {
  @ApiPropertyOptional({
    enum: ReportStatus,
    description: 'Filter reports by status',
    example: ReportStatus.NEW,
  })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional({
    default: 1,
    description: 'Page number',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    default: 10,
    description: 'Items per page',
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perPage?: number;
}

export class UpdateReportDto {
  @ApiPropertyOptional({
    enum: ReportStatus,
    description: 'Report status',
    example: ReportStatus.REVIEWING,
  })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional({
    description: 'Assignee teacher user ID or null to unassign',
    example: 'user-teacher-id',
  })
  @IsOptional()
  @IsString()
  assigneeId?: string | null;

  @ApiPropertyOptional({
    description: 'Snake case alias for assigneeId',
    example: 'user-teacher-id',
  })
  @IsOptional()
  @IsString()
  assignee_id?: string | null;
}

export class AddReportNoteDto {
  @ApiProperty({
    description: 'Note body text',
    example: 'Spoke with the student after class. Scheduled follow-up.',
  })
  @IsString()
  @IsNotEmpty()
  body: string;
}
