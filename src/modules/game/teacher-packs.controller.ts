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

@ApiTags('teacher-game-packs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TEACHER)
@Controller('teacher/game-packs')
export class TeacherPacksController {
  constructor(private readonly packsService: PacksService) {}

  @ApiOperation({ summary: 'List game question packs for teacher school' })
  @Get()
  list(@GetUser('userId') userId: string, @Query() query: PackListQueryDto) {
    return this.packsService.listTeacherPacks(userId, query);
  }

  @ApiOperation({ summary: 'Create a game question pack' })
  @Post()
  create(@GetUser('userId') userId: string, @Body() dto: CreatePackDto) {
    return this.packsService.createTeacherPack(userId, dto);
  }

  @ApiOperation({ summary: 'Get game question pack detail' })
  @Get(':id')
  get(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.packsService.getTeacherPack(userId, id);
  }

  @ApiOperation({ summary: 'Update game question pack' })
  @Patch(':id')
  update(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePackDto,
  ) {
    return this.packsService.updateTeacherPack(userId, id, dto);
  }

  @ApiOperation({ summary: 'Delete a draft game question pack' })
  @Delete(':id')
  delete(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.packsService.deleteTeacherPack(userId, id);
  }
}
