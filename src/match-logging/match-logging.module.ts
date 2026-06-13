import { Module } from '@nestjs/common';
import { MatchLoggingService } from './match-logging.service';
import { MatchLoggingController } from './match-logging.controller';

@Module({
  providers: [MatchLoggingService],
  controllers: [MatchLoggingController]
})
export class MatchLoggingModule {}
