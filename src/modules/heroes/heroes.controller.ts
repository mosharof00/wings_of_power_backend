import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HeroesService } from './heroes.service';

@ApiTags('heroes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.STUDENT)
@Controller('heroes')
export class HeroesController {
  constructor(private readonly heroesService: HeroesService) {}

  @ApiOperation({ summary: 'List all heroes with unlock status for student' })
  @Get()
  getHeroes(@GetUser('userId') userId: string) {
    return this.heroesService.findAll(userId);
  }

  @ApiOperation({ summary: 'Select an unlocked hero' })
  @Post(':id/select')
  selectHero(
    @GetUser('userId') userId: string,
    @Param('id') heroId: string,
  ) {
    return this.heroesService.select(userId, heroId);
  }
}
