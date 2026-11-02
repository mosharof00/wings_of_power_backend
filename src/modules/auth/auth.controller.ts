import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetUser } from './decorators/get-user.decorator';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  RegisterAdminDto,
  ResetPasswordDto,
  SchoolProfileDto,
  StaffLoginDto,
  VerifyEmailDto,
} from './dto/staff-auth.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import {
  JoinCodeDto,
  RegisterStudentDto,
  SelectHeroDto,
  StudentForgotPasswordDto,
  StudentLoginDto,
} from './dto/student-auth.dto';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Register an admin and email a verification code' })
  @Post('admin/register')
  registerAdmin(@Body() dto: RegisterAdminDto) {
    return this.authService.registerAdmin(dto);
  }

  @ApiOperation({ summary: 'Verify an admin email with the 6-digit code' })
  @Post('admin/verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @ApiOperation({ summary: 'Admin login' })
  @Post('admin/login')
  loginAdmin(@Body() dto: StaffLoginDto) {
    return this.authService.loginAdmin(dto);
  }

  @ApiOperation({ summary: 'Email a staff password-reset code' })
  @Post('admin/forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @ApiOperation({ summary: 'Set a new staff password with a reset code' })
  @Post('admin/reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @ApiOperation({ summary: 'Create the school profile for this deployment' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('school')
  createSchool(
    @GetUser('userId') userId: string,
    @Body() dto: SchoolProfileDto,
  ) {
    return this.authService.createSchool(userId, dto);
  }

  @ApiOperation({ summary: 'Teacher or admin login' })
  @Post('staff/login')
  loginStaff(@Body() dto: StaffLoginDto) {
    return this.authService.loginStaff(dto);
  }

  @ApiOperation({ summary: 'Accept a teacher invite and create the account' })
  @Post('teacher/accept-invite')
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.authService.acceptInvite(dto);
  }

  @ApiOperation({ summary: 'Preview a class from its join code' })
  @Post('student/join-code')
  joinCode(@Body() dto: JoinCodeDto) {
    return this.authService.joinCode(dto);
  }

  @ApiOperation({ summary: 'Register a student into a pending class' })
  @Post('student/register')
  registerStudent(@Body() dto: RegisterStudentDto) {
    return this.authService.registerStudent(dto);
  }

  @ApiOperation({ summary: 'Student login' })
  @Post('student/login')
  loginStudent(@Body() dto: StudentLoginDto) {
    return this.authService.loginStudent(dto);
  }

  @ApiOperation({ summary: 'Request a student password reset' })
  @Post('student/forgot-password')
  studentForgotPassword(@Body() dto?: StudentForgotPasswordDto) {
    return this.authService.studentForgotPassword(dto);
  }

  @ApiOperation({ summary: 'Select a starter or unlocked hero' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('student/select-hero')
  selectHero(@GetUser('userId') userId: string, @Body() dto: SelectHeroDto) {
    return this.authService.selectHero(userId, dto);
  }

  @ApiOperation({ summary: 'Current user' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@GetUser('userId') userId: string) {
    return this.authService.me(userId);
  }

  @ApiOperation({ summary: 'Stateless logout' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout() {
    return this.authService.logout();
  }

  @ApiOperation({ summary: 'Change the current password' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('password')
  changePassword(
    @GetUser('userId') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, dto);
  }
}
