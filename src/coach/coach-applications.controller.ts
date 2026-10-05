import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountStatus, Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CoachService } from './coach.service';
import { ReviewCoachApplicationDto } from './dto/coach.dto';

// The System Administrator's Coach/Manager approval queue.
@ApiTags('Coach')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('coach-applications')
export class CoachApplicationsController {
  constructor(private readonly coachService: CoachService) {}

  @Get()
  @ApiOperation({ summary: 'List coach account applications (Admin only)' })
  list(@Query('status') status?: AccountStatus) {
    return this.coachService.listApplications(status);
  }

  @Patch(':userId')
  @ApiOperation({ summary: 'Approve or deny a coach account (Admin only)' })
  review(
    @Param('userId') userId: string,
    @Body() dto: ReviewCoachApplicationDto,
  ) {
    return this.coachService.reviewApplication(userId, dto.approve);
  }
}
