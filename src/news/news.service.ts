import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GameTitle, NewsCategory, NewsStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateNewsDto } from './dto/create-news.dto';
import { UpdateNewsDto } from './dto/update-news.dto';

const ARTICLE_INCLUDE = {
  author: { select: { id: true, displayName: true } },
} satisfies Prisma.NewsArticleInclude;

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  findPublished(gameTitle?: GameTitle, category?: NewsCategory) {
    return this.prisma.newsArticle.findMany({
      where: {
        status: NewsStatus.PUBLISHED,
        ...(category ? { category } : {}),
        // A "general" article (gameTitle null) belongs to every division, so a
        // filtered request returns it alongside that division's own articles.
        ...(gameTitle ? { OR: [{ gameTitle }, { gameTitle: null }] } : {}),
      },
      include: ARTICLE_INCLUDE,
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  findAllForAdmin() {
    return this.prisma.newsArticle.findMany({
      include: ARTICLE_INCLUDE,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async findOnePublished(id: string) {
    const article = await this.prisma.newsArticle.findFirst({
      where: { id, status: NewsStatus.PUBLISHED },
      include: ARTICLE_INCLUDE,
    });
    if (!article) throw new NotFoundException('Article not found');
    return article;
  }

  async create(
    dto: CreateNewsDto,
    authorId: string,
    image?: Express.Multer.File,
  ) {
    const uploaded = image?.buffer
      ? await this.cloudinaryService.upload(image.buffer, 'collegium/news')
      : null;
    const status = dto.status ?? NewsStatus.DRAFT;

    return this.prisma.newsArticle.create({
      data: {
        title: dto.title,
        excerpt: dto.excerpt,
        body: dto.body,
        category: dto.category,
        gameTitle: dto.gameTitle ?? null,
        status,
        isFeatured: dto.isFeatured ?? false,
        image: uploaded?.url,
        imagePublicId: uploaded?.publicId,
        authorId,
        publishedAt: status === NewsStatus.PUBLISHED ? new Date() : null,
      },
      include: ARTICLE_INCLUDE,
    });
  }

  async update(id: string, dto: UpdateNewsDto, image?: Express.Multer.File) {
    const existing = await this.prisma.newsArticle.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Article not found');

    const uploaded = image?.buffer
      ? await this.cloudinaryService.upload(image.buffer, 'collegium/news')
      : null;
    if (uploaded && existing.imagePublicId) {
      await this.destroyImage(existing.imagePublicId);
    }

    // publishedAt is stamped the first time an article goes live and kept
    // afterwards, so unpublishing and republishing doesn't reset its date.
    const goingLive =
      dto.status === NewsStatus.PUBLISHED && !existing.publishedAt;

    return this.prisma.newsArticle.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.excerpt !== undefined ? { excerpt: dto.excerpt } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.gameTitle !== undefined ? { gameTitle: dto.gameTitle } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.isFeatured !== undefined ? { isFeatured: dto.isFeatured } : {}),
        ...(uploaded
          ? { image: uploaded.url, imagePublicId: uploaded.publicId }
          : {}),
        ...(goingLive ? { publishedAt: new Date() } : {}),
      },
      include: ARTICLE_INCLUDE,
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.newsArticle.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Article not found');
    if (existing.imagePublicId) await this.destroyImage(existing.imagePublicId);
    await this.prisma.newsArticle.delete({ where: { id } });
    return { id };
  }

  private async destroyImage(publicId: string) {
    try {
      await this.cloudinaryService.destroy(publicId);
    } catch (err) {
      this.logger.warn(
        `Failed to delete news image ${publicId}: ${(err as Error).message}`,
      );
    }
  }
}
