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
  AddReportNoteDto,
  StaffReportQueryDto,
  UpdateReportDto,
} from './dto/staff-report.dto';
import { ReportsService } from './reports.service';

@ApiTags('admin-safe-space')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/safe-space')
export class AdminReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @ApiOperation({ summary: 'List safe space reports for school' })
  @Get('reports')
  listReports(
    @GetUser('userId') userId: string,
    @Query() query: StaffReportQueryDto,
  ) {
    return this.reportsService.listAdminReports(userId, query);
  }

  @ApiOperation({
    summary: 'Get safe space report detail with notes and student nickname',
  })
  @Get('reports/:id')
  getReport(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.reportsService.getAdminReport(userId, id);
  }

  @ApiOperation({ summary: 'Update report status and/or assignee' })
  @Patch('reports/:id')
  updateReport(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReportDto,
  ) {
    return this.reportsService.updateAdminReport(userId, id, dto);
  }

  @ApiOperation({ summary: 'Add note to safe space report' })
  @Post('reports/:id/notes')
  addNote(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: AddReportNoteDto,
  ) {
    return this.reportsService.addAdminReportNote(userId, id, dto);
  }
}
