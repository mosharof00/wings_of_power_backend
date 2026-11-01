import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ClassesService } from './classes.service';
import { ChangeTeacherDto, CreateClassDto } from './dto/admin-class.dto';
import { ClassQueryDto } from './dto/class-query.dto';

@ApiTags('admin-classes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @ApiOperation({ summary: 'Classes in the admin school' })
  @Get('classes')
  list(@GetUser('userId') userId: string, @Query() query: ClassQueryDto) {
    return this.classesService.adminList(userId, query);
  }

  @ApiOperation({ summary: 'Create a class and its first active code' })
  @Post('classes')
  create(@GetUser('userId') userId: string, @Body() dto: CreateClassDto) {
    return this.classesService.createClass(userId, dto);
  }

  @ApiOperation({ summary: 'Class detail' })
  @Get('classes/:id')
  detail(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.classesService.adminDetail(userId, id);
  }

  @ApiOperation({ summary: 'Assign a different teacher' })
  @Post('classes/:id/change-teacher')
  changeTeacher(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: ChangeTeacherDto,
  ) {
    return this.classesService.changeTeacher(userId, id, dto);
  }

  @ApiOperation({ summary: 'Revoke the active code and issue a new one' })
  @Post('classes/:id/codes')
  regenerate(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.classesService.regenerateCode(userId, id);
  }

  @ApiOperation({ summary: 'Class creation and code renewal requests' })
  @Get('class-requests')
  requests(@GetUser('userId') userId: string, @Query() query: ClassQueryDto) {
    return this.classesService.classRequests(userId, query);
  }

  @ApiOperation({ summary: 'Approve a class creation request' })
  @Post('class-requests/:id/approve')
  approveCreation(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.classesService.approveCreation(userId, id);
  }

  @ApiOperation({ summary: 'Reject a class creation request' })
  @Post('class-requests/:id/reject')
  rejectCreation(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.classesService.rejectCreation(userId, id);
  }

  @ApiOperation({ summary: 'Approve a code renewal and issue a new code' })
  @Post('code-renewals/:id/approve')
  approveRenewal(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.classesService.approveRenewal(userId, id);
  }
}
