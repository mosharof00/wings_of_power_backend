import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AcceptInviteDto {
  @ApiProperty({ example: 'invite-token' })
  @IsString()
  @MinLength(1)
  token: string;

  @ApiProperty({ example: 'password1', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'password1', minLength: 8 })
  @IsString()
  @MinLength(8)
  confirmPassword: string;

  @ApiProperty({ example: 'Ada Teacher' })
  @IsString()
  @MinLength(1)
  name: string;
}
