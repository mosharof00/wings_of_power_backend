import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { UserType } from 'prisma/generated/client';

export class CreateUserDto {
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ example: '019948547647' })
  @ApiProperty()
  phone_number?: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @MinLength(8, { message: 'Password should be minimum 8 characters' })
  password: string;

  @ApiPropertyOptional({
    enum: UserType,
    default: UserType.VOLUNTEER,
  })
  @ApiProperty({ example: UserType.VOLUNTEER })
  @IsOptional()
  @IsEnum(UserType)
  type?: UserType;
}
