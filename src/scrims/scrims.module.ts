import { Module } from '@nestjs/common';
import { ScrimsController } from './scrims.controller';
import { ScrimsService } from './scrims.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [NotificationsModule, RealtimeModule],
  controllers: [ScrimsController],
  providers: [ScrimsService],
  exports: [ScrimsService],
})
export class ScrimsModule {}
