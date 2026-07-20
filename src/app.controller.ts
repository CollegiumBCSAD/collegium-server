import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators/public.decorator';

// ponytail: YAGNI - deleted AppService tier for static root endpoint
@Controller()
export class AppController {
  @Public()
  @Get()
  getHello(): string {
    return 'Hello World!';
  }
}
