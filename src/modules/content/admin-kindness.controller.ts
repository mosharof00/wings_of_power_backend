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
import {
  CreateKindnessItemDto,
  KindnessListQueryDto,
  UpdateKindnessItemDto,
} from './dto/kindness.dto';
import { KindnessService } from './kindness.service';

@ApiTags('admin-kindness-corner')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/kindness-corner')
export class AdminKindnessController {
  constructor(private readonly kindnessService: KindnessService) {}

  @ApiOperation({ summary: 'Paginated list of kindness corner items' })
  @Get()
  list(
    @GetUser('userId') userId: string,
    @Query() query: KindnessListQueryDto,
  ) {
    return this.kindnessService.list(userId, query);
  }

  @ApiOperation({ summary: 'Create a kindness corner item' })
  @Post()
  create(
    @GetUser('userId') userId: string,
    @Body() dto: CreateKindnessItemDto,
  ) {
    return this.kindnessService.create(userId, dto);
  }

  @ApiOperation({ summary: 'Get a kindness corner item by id' })
  @Get(':id')
  get(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.kindnessService.get(userId, id);
  }

  @ApiOperation({ summary: 'Update a kindness corner item' })
  @Patch(':id')
  update(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateKindnessItemDto,
  ) {
    return this.kindnessService.update(userId, id, dto);
  }

  @ApiOperation({ summary: 'Soft delete a kindness corner item' })
  @Delete(':id')
  delete(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.kindnessService.delete(userId, id);
  }
}
