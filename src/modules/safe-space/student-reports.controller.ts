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
import { ActiveStudentGuard } from '../../common/guard/role/active-student.guard';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateReportDto,
  CreateVisitDto,
  ReportQueryDto,
} from './dto/report.dto';
import { ReportsService } from './reports.service';

@ApiTags('safe-space')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ActiveStudentGuard)
@Roles(Role.STUDENT)
@Controller('safe-space')
export class StudentReportsController {
  constructor(private readonly reportsService: ReportsService) { }

  @ApiOperation({ summary: 'Submit a safe space report' })
  @Post('reports')
  createReport(
    @GetUser('userId') userId: string,
    @Body() dto: CreateReportDto,
  ) {
    return this.reportsService.createReport(userId, dto);
  }

  @ApiOperation({ summary: 'List submitted safe space reports' })
  @Get('reports')
  listReports(
    @GetUser('userId') userId: string,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.listStudentReports(userId, query);
  }

  @ApiOperation({ summary: 'Get safe space report detail' })
  @Get('reports/:id')
  getReport(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.reportsService.getStudentReport(userId, id);
  }

  @ApiOperation({ summary: 'Record a safe space calm room visit' })
  @Post('visits')
  createVisit(@GetUser('userId') userId: string, @Body() dto: CreateVisitDto) {
    return this.reportsService.createVisit(userId, dto);
  }
}
