import { Module } from '@nestjs/common';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventTeamsService } from './event-teams.service';
import { EventDocumentsService } from './event-documents.service';
import { EventBracketService } from './event-bracket.service';

@Module({
  imports: [CloudinaryModule],
  controllers: [EventsController],
  providers: [
    EventsService,
    EventTeamsService,
    EventDocumentsService,
    EventBracketService,
  ],
  exports: [
    EventsService,
    EventTeamsService,
    EventDocumentsService,
    EventBracketService,
  ],
})
export class EventsModule {}
