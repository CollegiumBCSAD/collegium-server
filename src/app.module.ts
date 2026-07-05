import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { MatchLoggingModule } from './match-logging/match-logging.module';
import { AuthModule } from './auth/auth.module';
import { UniversitiesModule } from './universities/universities.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { CacheModule } from '@nestjs/cache-manager';
import KeyvRedis from '@keyv/redis';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        stores: [
          new KeyvRedis(configService.get<string>('REDIS_URL')),
        ],
      }),
      inject: [ConfigService],
    }),
    PrismaModule, 
    MatchLoggingModule, AuthModule, UniversitiesModule, TournamentsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
