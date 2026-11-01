import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AttemptsService } from './attempts.service';
import { QuizzesService } from './quizzes.service';
import { StudentQuizzesController } from './student-quizzes.controller';
import { TeacherQuizzesController } from './teacher-quizzes.controller';

@Module({
  imports: [AuthModule],
  controllers: [TeacherQuizzesController, StudentQuizzesController],
  providers: [QuizzesService, AttemptsService],
  exports: [QuizzesService, AttemptsService],
})
export class QuizzesModule {}
