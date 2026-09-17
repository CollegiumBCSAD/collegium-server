import { Module } from '@nestjs/common';
import { UniversitiesModule } from '../universities/universities.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { OcrModule } from '../ocr/ocr.module';
import { RankingModule } from '../ranking/ranking.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';

@Module({
  imports: [
    UniversitiesModule,
    NotificationsModule,
    CloudinaryModule,
    OcrModule,
    RankingModule,
    RealtimeModule,
  ],
  controllers: [TournamentsController],
  providers: [TournamentsService],
  exports: [TournamentsService],
})
export class TournamentsModule {}
