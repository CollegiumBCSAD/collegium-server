import { Module } from '@nestjs/common';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventTeamsService } from './event-teams.service';

@Module({
  imports: [CloudinaryModule],
  controllers: [EventsController],
  providers: [EventsService, EventTeamsService],
  exports: [EventsService, EventTeamsService],
})
export class EventsModule {}
