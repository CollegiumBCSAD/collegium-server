import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CoachModule } from '../coach/coach.module';
import {
  RosterChangesController,
  TeamRosterController,
} from './rosters.controller';
import { RostersService } from './rosters.service';

@Module({
  imports: [NotificationsModule, CoachModule],
  controllers: [TeamRosterController, RosterChangesController],
  providers: [RostersService],
})
export class RostersModule {}
