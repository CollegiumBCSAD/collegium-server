import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AthletesService } from './athletes.service';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Athletes')
@Controller('athletes')
export class AthletesController {
  constructor(private readonly athletesService: AthletesService) {}

  @Public()
  @Get(':id')
  @ApiOperation({
    summary:
      "Get an athlete's public profile card (identity, rosters, recent matches)",
  })
  getPublicProfile(@Param('id') id: string) {
    return this.athletesService.getPublicProfile(id);
  }
}
