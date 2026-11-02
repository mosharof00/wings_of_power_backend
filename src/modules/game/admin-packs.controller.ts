import {
  Body,
  Controller,
  Delete,
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
import { CreatePackDto, PackListQueryDto, UpdatePackDto } from './dto/pack.dto';
import { PacksService } from './packs.service';

@ApiTags('admin-game-packs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/game-packs')
export class AdminPacksController {
  constructor(private readonly packsService: PacksService) {}

  @ApiOperation({ summary: 'List game question packs for admin' })
  @Get()
  list(@GetUser('userId') userId: string, @Query() query: PackListQueryDto) {
    return this.packsService.listAdminPacks(userId, query);
  }

  @ApiOperation({ summary: 'Create a game question pack' })
  @Post()
  create(@GetUser('userId') userId: string, @Body() dto: CreatePackDto) {
    return this.packsService.createAdminPack(userId, dto);
  }

  @ApiOperation({ summary: 'Get game question pack detail' })
  @Get(':id')
  get(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.packsService.getAdminPack(userId, id);
  }

  @ApiOperation({ summary: 'Update game question pack' })
  @Patch(':id')
  update(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePackDto,
  ) {
    return this.packsService.updateAdminPack(userId, id, dto);
  }

  @ApiOperation({ summary: 'Delete a draft game question pack' })
  @Delete(':id')
  delete(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.packsService.deleteAdminPack(userId, id);
  }
}
