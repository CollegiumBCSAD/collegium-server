import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UniversitiesModule } from './universities/universities.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { TeamsModule } from './teams/teams.module';
import { ScrimsModule } from './scrims/scrims.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RankingModule } from './ranking/ranking.module';
import { MatchesModule } from './matches/matches.module';
import { AthletesModule } from './athletes/athletes.module';
import { NewsModule } from './news/news.module';
import { EventsModule } from './events/events.module';
import { CoachModule } from './coach/coach.module';
import { RostersModule } from './rosters/rosters.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    UniversitiesModule,
    TournamentsModule,
    TeamsModule,
    ScrimsModule,
    NotificationsModule,
    RankingModule,
    MatchesModule,
    AthletesModule,
    NewsModule,
    EventsModule,
    CoachModule,
    RostersModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
