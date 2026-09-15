import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RankingService } from './ranking.service';
import { RankingController } from './ranking.controller';

@Module({
  imports: [PrismaModule],
  controllers: [RankingController],
  providers: [RankingService],
  exports: [RankingService],
})
export class RankingModule {}
