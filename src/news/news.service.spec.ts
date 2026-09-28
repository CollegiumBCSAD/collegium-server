import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GameTitle, NewsCategory, NewsStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { NewsService } from './news.service';

type FindManyCall = { where: Prisma.NewsArticleWhereInput };
type UpdateCall = { data: Prisma.NewsArticleUpdateInput };
type CreateCall = { data: Prisma.NewsArticleUncheckedCreateInput };

const firstCallArg = <T>(fn: jest.Mock): T =>
  (fn.mock.calls as unknown[][])[0][0] as T;

const mockPrismaService = {
  newsArticle: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

const mockCloudinaryService = {
  upload: jest.fn(),
  destroy: jest.fn(),
};

const baseDto = {
  title: 'Circuit opens',
  excerpt: 'Registration is live.',
  body: '# Circuit opens\n\nRegistration is live.',
  category: NewsCategory.TOURNAMENT_CIRCUIT,
};

describe('NewsService', () => {
  let service: NewsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NewsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
      ],
    }).compile();

    service = module.get<NewsService>(NewsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findPublished()', () => {
    it('returns only published articles when no filters are given', async () => {
      mockPrismaService.newsArticle.findMany.mockResolvedValue([]);

      await service.findPublished();

      const arg = firstCallArg<FindManyCall>(
        mockPrismaService.newsArticle.findMany,
      );
      expect(arg.where).toEqual({ status: NewsStatus.PUBLISHED });
    });

    it('includes general articles alongside the requested division', async () => {
      mockPrismaService.newsArticle.findMany.mockResolvedValue([]);

      await service.findPublished(GameTitle.VALORANT);

      const arg = firstCallArg<FindManyCall>(
        mockPrismaService.newsArticle.findMany,
      );
      expect(arg.where).toEqual({
        status: NewsStatus.PUBLISHED,
        OR: [{ gameTitle: GameTitle.VALORANT }, { gameTitle: null }],
      });
    });
  });

  describe('findOnePublished()', () => {
    it('throws NotFoundException for a draft or missing article', async () => {
      mockPrismaService.newsArticle.findFirst.mockResolvedValue(null);

      await expect(service.findOnePublished('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create()', () => {
    it('defaults to a draft with no publishedAt', async () => {
      mockPrismaService.newsArticle.create.mockResolvedValue({ id: 'a1' });

      await service.create(baseDto, 'admin-1');

      const arg = firstCallArg<CreateCall>(
        mockPrismaService.newsArticle.create,
      );
      expect(arg.data.status).toBe(NewsStatus.DRAFT);
      expect(arg.data.publishedAt).toBeNull();
      expect(arg.data.authorId).toBe('admin-1');
      expect(mockCloudinaryService.upload).not.toHaveBeenCalled();
    });

    it('stamps publishedAt when created as published', async () => {
      mockPrismaService.newsArticle.create.mockResolvedValue({ id: 'a1' });

      await service.create(
        { ...baseDto, status: NewsStatus.PUBLISHED },
        'admin-1',
      );

      const arg = firstCallArg<CreateCall>(
        mockPrismaService.newsArticle.create,
      );
      expect(arg.data.publishedAt).toBeInstanceOf(Date);
    });

    it('uploads an image to the news folder and stores both columns', async () => {
      mockCloudinaryService.upload.mockResolvedValue({
        url: 'https://cdn/x.png',
        publicId: 'collegium/news/x',
      });
      mockPrismaService.newsArticle.create.mockResolvedValue({ id: 'a1' });

      await service.create(baseDto, 'admin-1', {
        buffer: Buffer.from('x'),
      } as Express.Multer.File);

      expect(mockCloudinaryService.upload).toHaveBeenCalledWith(
        expect.any(Buffer),
        'collegium/news',
      );
      const arg = firstCallArg<CreateCall>(
        mockPrismaService.newsArticle.create,
      );
      expect(arg.data.image).toBe('https://cdn/x.png');
      expect(arg.data.imagePublicId).toBe('collegium/news/x');
    });
  });

  describe('update()', () => {
    it('stamps publishedAt the first time an article goes live', async () => {
      mockPrismaService.newsArticle.findUnique.mockResolvedValue({
        id: 'a1',
        publishedAt: null,
        imagePublicId: null,
      });
      mockPrismaService.newsArticle.update.mockResolvedValue({ id: 'a1' });

      await service.update('a1', { status: NewsStatus.PUBLISHED });

      const arg = firstCallArg<UpdateCall>(
        mockPrismaService.newsArticle.update,
      );
      expect(arg.data.publishedAt).toBeInstanceOf(Date);
    });

    it('keeps the original publishedAt when republishing', async () => {
      const original = new Date('2026-01-01');
      mockPrismaService.newsArticle.findUnique.mockResolvedValue({
        id: 'a1',
        publishedAt: original,
        imagePublicId: null,
      });
      mockPrismaService.newsArticle.update.mockResolvedValue({ id: 'a1' });

      await service.update('a1', { status: NewsStatus.PUBLISHED });

      const arg = firstCallArg<UpdateCall>(
        mockPrismaService.newsArticle.update,
      );
      expect(arg.data.publishedAt).toBeUndefined();
    });

    it('only writes the fields that were provided', async () => {
      mockPrismaService.newsArticle.findUnique.mockResolvedValue({
        id: 'a1',
        publishedAt: null,
        imagePublicId: null,
      });
      mockPrismaService.newsArticle.update.mockResolvedValue({ id: 'a1' });

      await service.update('a1', { title: 'New title' });

      const arg = firstCallArg<UpdateCall>(
        mockPrismaService.newsArticle.update,
      );
      expect(arg.data).toEqual({ title: 'New title' });
    });

    it('replaces an existing image and destroys the old asset', async () => {
      mockPrismaService.newsArticle.findUnique.mockResolvedValue({
        id: 'a1',
        publishedAt: null,
        imagePublicId: 'collegium/news/old',
      });
      mockCloudinaryService.upload.mockResolvedValue({
        url: 'https://cdn/new.png',
        publicId: 'collegium/news/new',
      });
      mockPrismaService.newsArticle.update.mockResolvedValue({ id: 'a1' });

      await service.update('a1', {}, {
        buffer: Buffer.from('x'),
      } as Express.Multer.File);

      expect(mockCloudinaryService.destroy).toHaveBeenCalledWith(
        'collegium/news/old',
      );
      const arg = firstCallArg<UpdateCall>(
        mockPrismaService.newsArticle.update,
      );
      expect(arg.data.image).toBe('https://cdn/new.png');
    });

    it('throws NotFoundException for a missing article', async () => {
      mockPrismaService.newsArticle.findUnique.mockResolvedValue(null);

      await expect(service.update('nope', { title: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove()', () => {
    it('destroys the image asset before deleting the row', async () => {
      mockPrismaService.newsArticle.findUnique.mockResolvedValue({
        id: 'a1',
        imagePublicId: 'collegium/news/x',
      });
      mockPrismaService.newsArticle.delete.mockResolvedValue({ id: 'a1' });

      await service.remove('a1');

      expect(mockCloudinaryService.destroy).toHaveBeenCalledWith(
        'collegium/news/x',
      );
      expect(mockPrismaService.newsArticle.delete).toHaveBeenCalledWith({
        where: { id: 'a1' },
      });
    });

    it('throws NotFoundException for a missing article', async () => {
      mockPrismaService.newsArticle.findUnique.mockResolvedValue(null);

      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
    });
  });
});
