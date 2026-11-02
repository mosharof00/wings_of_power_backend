import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminKindnessController } from './admin-kindness.controller';
import { AdminStoriesController } from './admin-stories.controller';
import { KindnessService } from './kindness.service';
import { StoriesService } from './stories.service';
import { StudentStoriesController } from './student-stories.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    AdminStoriesController,
    StudentStoriesController,
    AdminKindnessController,
  ],
  providers: [StoriesService, KindnessService],
  exports: [StoriesService, KindnessService],
})
export class ContentModule {}
