import { Module } from '@nestjs/common';
import { MatchLoggingModule } from '../match-logging/match-logging.module';
import { UniversitiesModule } from '../universities/universities.module';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';

@Module({
  imports: [MatchLoggingModule, UniversitiesModule],
  controllers: [TournamentsController],
  providers: [TournamentsService],
})
export class TournamentsModule {}
