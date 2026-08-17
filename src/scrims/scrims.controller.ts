import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ScrimsService } from './scrims.service';
import { CreateScrimDto, AcceptScrimDto } from './dto/scrims.dto';
import { GameTitle, ScrimStatus } from '@prisma/client';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Scrims')
@Controller('scrims')
export class ScrimsController {
  constructor(private readonly scrimsService: ScrimsService) {}

  @Public()
  @Post()
  @ApiOperation({ summary: 'Post a new scrim offer' })
  createScrim(@Body() dto: CreateScrimDto) {
    return this.scrimsService.createScrim(dto);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get all available scrim offers' })
  getScrims(
    @Query('gameTitle') gameTitle?: GameTitle,
    @Query('status') status?: ScrimStatus,
  ) {
    return this.scrimsService.getScrims(gameTitle, status);
  }

  @Public()
  @Post(':id/accept')
  @ApiOperation({ summary: 'Accept an open scrim offer' })
  acceptScrim(@Param('id') id: string, @Body() dto: AcceptScrimDto) {
    return this.scrimsService.acceptScrim(id, dto);
  }

  @Public()
  @Post(':id/confirm')
  @ApiOperation({ summary: 'Confirm a pending scrim booking request' })
  confirmScrim(
    @Param('id') id: string,
    @Body('opponentId') selectedOpponentId?: string,
  ) {
    return this.scrimsService.confirmScrim(id, selectedOpponentId);
  }

  @Public()
  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a scrim offer' })
  cancelScrim(@Param('id') id: string) {
    return this.scrimsService.cancelScrim(id);
  }

  @Public()
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a scrim offer permanently' })
  deleteScrim(@Param('id') id: string) {
    return this.scrimsService.deleteScrim(id);
  }
}
