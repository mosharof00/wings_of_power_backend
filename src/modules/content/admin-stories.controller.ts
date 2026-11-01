import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
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
  CreateChapterDto,
  CreateStoryDto,
  PutAudioDto,
  PutPagesDto,
  StoryListQueryDto,
  UpdateStoryDto,
} from './dto/story.dto';
import { StoriesService } from './stories.service';

@ApiTags('admin-stories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminStoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  @ApiOperation({ summary: 'Stories in the admin school' })
  @Get('stories')
  list(@GetUser('userId') userId: string, @Query() query: StoryListQueryDto) {
    return this.storiesService.list(userId, query);
  }

  @ApiOperation({ summary: 'Create a draft story' })
  @Post('stories')
  create(@GetUser('userId') userId: string, @Body() dto: CreateStoryDto) {
    return this.storiesService.create(userId, dto);
  }

  @ApiOperation({ summary: 'Story with chapters, pages, and audio' })
  @Get('stories/:id')
  detail(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.storiesService.detail(userId, id);
  }

  @ApiOperation({ summary: 'Update story metadata or publish it' })
  @Patch('stories/:id')
  update(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateStoryDto,
  ) {
    return this.storiesService.update(userId, id, dto);
  }

  @ApiOperation({ summary: 'Add a chapter' })
  @Post('stories/:id/chapters')
  addChapter(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateChapterDto,
  ) {
    return this.storiesService.addChapter(userId, id, dto);
  }

  @ApiOperation({ summary: 'Replace the pages of a chapter' })
  @Put('chapters/:id/pages')
  replacePages(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: PutPagesDto,
  ) {
    return this.storiesService.replacePages(userId, id, dto);
  }

  @ApiOperation({ summary: 'Create or replace the chapter audio file' })
  @Put('chapters/:id/audio')
  putAudio(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: PutAudioDto,
  ) {
    return this.storiesService.putAudio(userId, id, dto);
  }
}
