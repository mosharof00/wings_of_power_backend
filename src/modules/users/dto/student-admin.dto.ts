import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { UserStatus } from 'prisma/generated/client';
import { PaginationDto } from '../../../common/pagination/dto/offset-pagination.dto';

export class StudentListQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class TeacherStudentListQueryDto extends StudentListQueryDto {
  @ApiPropertyOptional({ example: 'class-id' })
  @IsOptional()
  @IsString()
  classId?: string;
}

export class UpdateStudentStatusDto {
  @ApiProperty({ enum: [UserStatus.ACTIVE, UserStatus.INACTIVE] })
  @IsIn([UserStatus.ACTIVE, UserStatus.INACTIVE])
  status: typeof UserStatus.ACTIVE | typeof UserStatus.INACTIVE;
}

export class MoveClassDto {
  @ApiProperty({ example: 'class-id' })
  @IsString()
  @MinLength(1)
  classId: string;
}
