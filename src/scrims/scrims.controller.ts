import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ScrimsService } from './scrims.service';
import {
  CreateScrimDto,
  AcceptScrimDto,
  SendScrimChatDto,
  FinalizeScrimDto,
} from './dto/scrims.dto';
import { GameTitle, Role, ScrimStatus, User } from '@prisma/client';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Scrims')
@ApiBearerAuth()
@Controller('scrims')
export class ScrimsController {
  constructor(private readonly scrimsService: ScrimsService) {}

  @Roles(Role.ATHLETE, Role.NON_ATHLETE)
  @Post()
  @ApiOperation({ summary: 'Post a new scrim offer (Requires authentication)' })
  createScrim(@Req() req: { user?: User }, @Body() dto: CreateScrimDto) {
    return this.scrimsService.createScrim(dto, req.user);
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

  @Roles(Role.ATHLETE, Role.NON_ATHLETE)
  @Post(':id/accept')
  @ApiOperation({
    summary: 'Accept an open scrim offer (Requires authentication)',
  })
  acceptScrim(
    @Req() req: { user?: User },
    @Param('id') id: string,
    @Body() dto: AcceptScrimDto,
  ) {
    return this.scrimsService.acceptScrim(id, dto);
  }

  @Post(':id/confirm')
  @ApiOperation({
    summary:
      'Confirm a pending scrim booking request (Requires authentication)',
  })
  confirmScrim(
    @Param('id') id: string,
    @Body('opponentId') selectedOpponentId?: string,
  ) {
    return this.scrimsService.confirmScrim(id, selectedOpponentId);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a scrim offer (Requires authentication)' })
  cancelScrim(@Param('id') id: string) {
    return this.scrimsService.cancelScrim(id);
  }

  @Post(':id/scan')
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage() }))
  @ApiOperation({ summary: 'Mandatory pre-close OCR scoreboard scan for scrim' })
  scanScrim(
    @Param('id') id: string,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    return this.scrimsService.scanScrim(id, image);
  }

  @Post(':id/finalize')
  @ApiOperation({ summary: 'Finalize scrim match log and sync into dedicated ledger' })
  finalizeScrim(
    @Req() req: { user: User },
    @Param('id') id: string,
    @Body() dto: FinalizeScrimDto,
  ) {
    return this.scrimsService.finalizeScrim(id, req.user, dto);
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: 'Complete / close a booked scrim match' })
  completeScrim(@Param('id') id: string) {
    return this.scrimsService.completeScrim(id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a scrim offer permanently (Requires authentication)',
  })
  deleteScrim(@Param('id') id: string) {
    return this.scrimsService.deleteScrim(id);
  }

  @Public()
  @Get(':id/chat')
  @ApiOperation({ summary: 'Get War Room chat messages' })
  getScrimChat(@Param('id') id: string) {
    return this.scrimsService.getScrimChat(id);
  }

  @Post(':id/chat')
  @ApiOperation({
    summary: 'Send a message in the War Room chat (Requires authentication)',
  })
  sendScrimChat(
    @Req() req: { user: User },
    @Param('id') id: string,
    @Body() dto: SendScrimChatDto,
  ) {
    return this.scrimsService.sendScrimChat(id, req.user.id, dto.text);
  }
}
