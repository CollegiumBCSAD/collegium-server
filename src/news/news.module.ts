import { Module } from '@nestjs/common';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';

@Module({
  imports: [CloudinaryModule],
  controllers: [NewsController],
  providers: [NewsService],
  exports: [NewsService],
})
export class NewsModule {}
