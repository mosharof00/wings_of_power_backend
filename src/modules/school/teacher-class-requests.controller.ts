import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ClassesService } from './classes.service';
import { CodeRenewalDto, CreateClassRequestDto } from './dto/admin-class.dto';

@ApiTags('teacher-classes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TEACHER)
@Controller('teacher')
export class TeacherClassRequestsController {
  constructor(private readonly classesService: ClassesService) {}

  @ApiOperation({ summary: 'Ask an admin to create a class' })
  @Post('classes/requests')
  requestClass(
    @GetUser('userId') userId: string,
    @Body() dto: CreateClassRequestDto,
  ) {
    return this.classesService.requestClass(userId, dto);
  }

  @ApiOperation({ summary: 'Ask an admin to renew this class code' })
  @Post('classes/:id/code-renewal')
  requestRenewal(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: CodeRenewalDto,
  ) {
    return this.classesService.requestRenewal(userId, id, dto);
  }
}
