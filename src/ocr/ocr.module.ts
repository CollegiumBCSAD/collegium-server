import { Module } from '@nestjs/common';
import { OcrService } from './ocr.service';
import { FuzzyMatcherService } from './fuzzy-matcher.service';

@Module({
  providers: [OcrService, FuzzyMatcherService],
  exports: [OcrService, FuzzyMatcherService],
})
export class OcrModule {}

