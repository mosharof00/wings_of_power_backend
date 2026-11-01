import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QuizzesService } from './quizzes.service';
import { TeacherQuizzesController } from './teacher-quizzes.controller';

@Module({
  imports: [AuthModule],
  controllers: [TeacherQuizzesController],
  providers: [QuizzesService],
  exports: [QuizzesService],
})
export class QuizzesModule {}
