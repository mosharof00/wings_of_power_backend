import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import {
  InviteStaffDto,
  StaffListQueryDto,
  UpdateStaffDto,
} from './dto/staff-profile.dto';
import { StaffService } from './staff.service';

@ApiTags('admin-staff')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminStaffController {
  constructor(private readonly staffService: StaffService) {}

  @ApiOperation({ summary: 'Teachers and admins in this school' })
  @Get('staff')
  list(@GetUser('userId') userId: string, @Query() query: StaffListQueryDto) {
    return this.staffService.list(userId, query);
  }

  @ApiOperation({ summary: 'Invite a teacher' })
  @Post('staff/invite')
  invite(@GetUser('userId') userId: string, @Body() dto: InviteStaffDto) {
    return this.staffService.invite(userId, dto);
  }

  @ApiOperation({ summary: 'Staff profile' })
  @Get('staff/:id')
  detail(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.staffService.detail(userId, id);
  }

  @ApiOperation({ summary: 'Update a staff name' })
  @Patch('staff/:id')
  update(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staffService.update(userId, id, dto);
  }

  @ApiOperation({ summary: 'Set an inactive staff user back to active' })
  @Post('staff/:id/reactivate')
  reactivate(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.staffService.reactivate(userId, id);
  }
}
