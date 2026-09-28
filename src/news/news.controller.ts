import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  Request,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { GameTitle, NewsCategory, Role } from '@prisma/client';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CreateNewsDto } from './dto/create-news.dto';
import { UpdateNewsDto } from './dto/update-news.dto';
import { NewsService } from './news.service';

const IMAGE_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, accept: boolean) => void,
  ) => {
    callback(
      file.mimetype.startsWith('image/')
        ? null
        : new Error('Only image files are allowed'),
      file.mimetype.startsWith('image/'),
    );
  },
};

@ApiTags('News')
@ApiBearerAuth()
@Controller('news')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List published news articles' })
  findAll(
    @Query('gameTitle', new ParseEnumPipe(GameTitle, { optional: true }))
    gameTitle?: GameTitle,
    @Query('category', new ParseEnumPipe(NewsCategory, { optional: true }))
    category?: NewsCategory,
  ) {
    return this.newsService.findPublished(gameTitle, category);
  }

  @Get('admin/all')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List every article including drafts (Admin only)' })
  findAllForAdmin() {
    return this.newsService.findAllForAdmin();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Read one published news article' })
  findOne(@Param('id') id: string) {
    return this.newsService.findOnePublished(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('image', IMAGE_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Write a news article (Admin only)' })
  create(
    @Body() dto: CreateNewsDto,
    @Request() req: { user: { id: string } },
    @UploadedFile() image?: Express.Multer.File,
  ) {
    return this.newsService.create(dto, req.user.id, image);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('image', IMAGE_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Edit a news article, or publish/unpublish it (Admin only)',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateNewsDto,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    return this.newsService.update(id, dto, image);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete a news article (Admin only)' })
  remove(@Param('id') id: string) {
    return this.newsService.remove(id);
  }
}
