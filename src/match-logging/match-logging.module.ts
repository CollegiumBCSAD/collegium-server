import { Module } from '@nestjs/common';
import { MatchLoggingService } from './match-logging.service';
import { MatchLoggingController } from './match-logging.controller';
import { VcsCalculatorService } from './vcs-calculator.service';

@Module({
  controllers: [MatchLoggingController],
  providers: [MatchLoggingService, VcsCalculatorService],
  exports: [MatchLoggingService, VcsCalculatorService],
})
export class MatchLoggingModule {}
