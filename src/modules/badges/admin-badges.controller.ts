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
import { BadgesService } from './badges.service';
import { PatchBadgesDto } from './dto/badge.dto';

@ApiTags('admin-badges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/badges')
export class AdminBadgesController {
  constructor(private readonly badgesService: BadgesService) {}

  @ApiOperation({
    summary: 'Get the six badges with earning criteria and distribution stats',
  })
  @Get()
  getBadges(@GetUser('userId') userId: string) {
    return this.badgesService.getAdminBadges(userId);
  }

  @ApiOperation({ summary: 'Update badge criteria and fields' })
  @Patch()
  @UsePipes(new ValidationPipe({ whitelist: false, transform: true }))
  patchBadges(@GetUser('userId') userId: string, @Body() dto: PatchBadgesDto) {
    return this.badgesService.patchAdminBadges(userId, dto);
  }
}
