import { Module } from '@nestjs/common';
import { BracketService } from './bracket.service';

@Module({
  providers: [BracketService],
  exports: [BracketService],
})
export class BracketModule {}
