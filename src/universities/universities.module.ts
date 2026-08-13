import { Module } from '@nestjs/common';
import { UniversitiesController } from './universities.controller';
import { UniversitiesService } from './universities.service';
import { GlickoService } from './glicko.service';

@Module({
  controllers: [UniversitiesController],
  providers: [UniversitiesService, GlickoService],
  exports: [UniversitiesService, GlickoService],
})
export class UniversitiesModule {}
