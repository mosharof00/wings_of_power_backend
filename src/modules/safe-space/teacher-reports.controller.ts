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
import { AddReportNoteDto, StaffReportQueryDto } from './dto/staff-report.dto';
import { ReportsService } from './reports.service';

@ApiTags('teacher-safe-space')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TEACHER)
@Controller('teacher/safe-space')
export class TeacherReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @ApiOperation({ summary: 'List safe space reports for teacher classes' })
  @Get('reports')
  listReports(
    @GetUser('userId') userId: string,
    @Query() query: StaffReportQueryDto,
  ) {
    return this.reportsService.listTeacherReports(userId, query);
  }

  @ApiOperation({ summary: 'Get safe space report detail with notes' })
  @Get('reports/:id')
  getReport(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.reportsService.getTeacherReport(userId, id);
  }

  @ApiOperation({ summary: 'Add note to safe space report' })
  @Post('reports/:id/notes')
  addNote(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: AddReportNoteDto,
  ) {
    return this.reportsService.addTeacherReportNote(userId, id, dto);
  }
}
