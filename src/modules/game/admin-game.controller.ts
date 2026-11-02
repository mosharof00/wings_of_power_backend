import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminMatchQueryDto, UpdateEligibilityConfigDto } from './dto/game.dto';
import { GameService } from './game.service';

@ApiTags('admin-game')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/game')
export class AdminGameController {
  constructor(private readonly gameService: GameService) {}

  @ApiOperation({ summary: 'List game matches with mode and phase filters' })
  @Get('matches')
  listMatches(
    @GetUser('userId') userId: string,
    @Query() query: AdminMatchQueryDto,
  ) {
    return this.gameService.listAdminMatches(userId, query);
  }

  @ApiOperation({
    summary: 'Get game match detail with teams and participants',
  })
  @Get('matches/:id')
  getMatchDetail(
    @GetUser('userId') userId: string,
    @Param('id') matchId: string,
  ) {
    return this.gameService.getAdminMatchDetail(userId, matchId);
  }

  @ApiOperation({ summary: 'Get school game eligibility configuration' })
  @Get('eligibility-config')
  getEligibilityConfig(@GetUser('userId') userId: string) {
    return this.gameService.getEligibilityConfig(userId);
  }

  @ApiOperation({ summary: 'Update school game eligibility configuration' })
  @Patch('eligibility-config')
  updateEligibilityConfig(
    @GetUser('userId') userId: string,
    @Body() dto: UpdateEligibilityConfigDto,
  ) {
    return this.gameService.updateEligibilityConfig(userId, dto);
  }
}
