import {
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PatchPointRulesDto } from './dto/points.dto';
import { PointsService } from './points.service';

@ApiTags('admin-point-rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/point-rules')
export class AdminPointRulesController {
  constructor(private readonly pointsService: PointsService) {}

  @ApiOperation({
    summary: 'Summary card metrics and configurable point rules',
  })
  @Get()
  getPointRules(@GetUser('userId') userId: string) {
    return this.pointsService.getPointRules(userId);
  }

  @ApiOperation({ summary: 'Update configurable point rules' })
  @Patch()
  @UsePipes(new ValidationPipe({ whitelist: false }))
  patchPointRules(
    @GetUser('userId') userId: string,
    @Body() body: PatchPointRulesDto,
  ) {
    return this.pointsService.patchPointRules(userId, body);
  }
}
