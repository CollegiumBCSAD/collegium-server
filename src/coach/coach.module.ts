import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OcrModule } from '../ocr/ocr.module';
import { CoachController } from './coach.controller';
import { CoachApplicationsController } from './coach-applications.controller';
import { TeamCoachingController } from './team-coaching.controller';
import { CoachService } from './coach.service';
import { PracticeService } from './practice.service';
import { TeamAuthorityService } from './team-authority.service';
import { TeamCoachGuard } from './guards/team-coach.guard';

@Module({
  imports: [NotificationsModule, OcrModule],
  controllers: [
    CoachController,
    CoachApplicationsController,
    TeamCoachingController,
  ],
  providers: [
    CoachService,
    PracticeService,
    TeamAuthorityService,
    TeamCoachGuard,
  ],
  exports: [TeamAuthorityService],
})
export class CoachModule {}
