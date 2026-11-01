import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminStoriesController } from './admin-stories.controller';
import { StoriesService } from './stories.service';
import { StudentStoriesController } from './student-stories.controller';

@Module({
  imports: [AuthModule],
  controllers: [AdminStoriesController, StudentStoriesController],
  providers: [StoriesService],
})
export class ContentModule {}
