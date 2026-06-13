import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { MatchLoggingModule } from './match-logging/match-logging.module';

@Module({
  imports: [PrismaModule, MatchLoggingModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
