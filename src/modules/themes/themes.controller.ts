import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateThemeDto, UpdateThemeDto } from './dto/theme.dto';
import { ThemesService } from './themes.service';

@ApiTags('themes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ThemesController {
  constructor(private readonly themesService: ThemesService) {}

  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List all story themes (admin)' })
  @Get('admin/themes')
  listAdmin() {
    return this.themesService.listAdmin();
  }

  @Roles(Role.ADMIN, Role.TEACHER, Role.STUDENT)
  @ApiOperation({ summary: 'List active story themes for pickers / library' })
  @Get('themes')
  listActive() {
    return this.themesService.listActive();
  }

  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a story theme' })
  @Post('admin/themes')
  create(@GetUser('userId') userId: string, @Body() dto: CreateThemeDto) {
    return this.themesService.create(userId, dto);
  }

  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update a story theme' })
  @Patch('admin/themes/:id')
  update(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateThemeDto,
  ) {
    return this.themesService.update(userId, id, dto);
  }

  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Deactivate a story theme' })
  @Delete('admin/themes/:id')
  deactivate(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.themesService.deactivate(userId, id);
  }
}
