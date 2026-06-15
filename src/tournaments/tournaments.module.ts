import { Module } from '@nestjs/common';
import { MatchLoggingModule } from '../match-logging/match-logging.module';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';

@Module({
  imports: [MatchLoggingModule], // Import so we can inject MatchLoggingService
  controllers: [TournamentsController],
  providers: [TournamentsService],
})
export class TournamentsModule {}
