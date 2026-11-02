import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActiveStudentGuard } from '../../common/guard/role/active-student.guard';
import { Role } from '../../common/guard/role/role.enum';
import { Roles } from '../../common/guard/role/roles.decorator';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JoinQueueDto } from './dto/game.dto';
import { GameService } from './game.service';

@ApiTags('game')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ActiveStudentGuard)
@Roles(Role.STUDENT)
@Controller('game')
export class StudentGameController {
  constructor(private readonly gameService: GameService) {}

  @ApiOperation({ summary: 'Check student game show eligibility' })
  @Get('eligibility')
  getEligibility(@GetUser('userId') userId: string) {
    return this.gameService.getEligibility(userId);
  }

  @ApiOperation({ summary: 'Static game show rules and how-to-play overview' })
  @Get('how-to-play')
  getHowToPlay(@GetUser('userId') userId: string) {
    return this.gameService.getHowToPlay(userId);
  }

  @ApiOperation({
    summary: 'Join matchmaking queue or start single practice match',
  })
  @Post('queue')
  joinQueue(@GetUser('userId') userId: string, @Body() dto: JoinQueueDto) {
    return this.gameService.joinQueue(userId, dto);
  }

  @ApiOperation({ summary: 'Cancel active matchmaking ticket' })
  @Delete('queue')
  cancelQueue(@GetUser('userId') userId: string) {
    return this.gameService.cancelQueue(userId);
  }

  @ApiOperation({ summary: 'Get match snapshot for participant' })
  @Get('matches/:id')
  getMatchSnapshot(
    @GetUser('userId') userId: string,
    @Param('id') matchId: string,
  ) {
    return this.gameService.getMatchSnapshot(userId, matchId);
  }

  @ApiOperation({ summary: 'Leave match and record leave timestamp' })
  @Post('matches/:id/leave')
  leaveMatch(@GetUser('userId') userId: string, @Param('id') matchId: string) {
    return this.gameService.leaveMatch(userId, matchId);
  }
}
