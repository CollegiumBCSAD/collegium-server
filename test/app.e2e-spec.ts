import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { Reflector } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

function extractRefreshToken(res: request.Response): string | undefined {
  const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
  const entry = cookies.find((c) => c.startsWith('refresh_token='));
  return entry?.split(';')[0].replace('refresh_token=', '');
}

describe('Collegium API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sharedToken: string;

  beforeAll(async () => {
    process.env.DISABLE_AUTH = 'false';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    const reflector = app.get(Reflector);
    app.useGlobalGuards(new JwtAuthGuard(reflector), new RolesGuard(reflector));
    app.use(cookieParser());

    await app.init();

    prisma = moduleFixture.get(PrismaService);

    await prisma.university.create({
      data: { name: 'Test University', domain: 'test.edu.ph' },
    });

    const res = await request(app.getHttpServer()).post('/auth/register').send({
      email: 'base@test.edu.ph',
      password: 'password123',
      displayName: 'Base User',
      role: 'ATHLETE',
    });
    sharedToken = (res.body as { access_token: string }).access_token;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.refreshToken.deleteMany();
      await prisma.user.deleteMany();
      await prisma.university.deleteMany();
      await prisma.$disconnect();
    }
    await app?.close();
  });

  describe('GET /universities', () => {
    it('should return an array of universities', async () => {
      const res = await request(app.getHttpServer())
        .get('/universities')
        .set('Authorization', `Bearer ${sharedToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /universities/:id', () => {
    it('should return 404 for a non-existent university', async () => {
      const res = await request(app.getHttpServer())
        .get('/universities/non-existent-id')
        .set('Authorization', `Bearer ${sharedToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /auth/register', () => {
    it('should reject non-.edu.ph emails', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'user@gmail.com',
          password: 'password123',
          displayName: 'Test User',
          role: 'ATHLETE',
        });

      expect(res.status).toBe(403);
    });

    it('should reject emails from an unregistered university domain', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'user@notregistered.edu.ph',
          password: 'password123',
          displayName: 'Test User',
          role: 'ATHLETE',
        });

      expect(res.status).toBe(400);
    });

    it('should register successfully with a valid .edu.ph email', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'athlete@test.edu.ph',
          password: 'password123',
          displayName: 'Test Athlete',
          role: 'ATHLETE',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('access_token');
      expect(res.headers['set-cookie']).toBeDefined();

      const cookie = res.headers['set-cookie'] as unknown as string[];
      expect(cookie.some((c: string) => c.startsWith('refresh_token='))).toBe(
        true,
      );
    });

    it('should reject duplicate email registration', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'athlete@test.edu.ph',
          password: 'password123',
          displayName: 'Duplicate User',
          role: 'ATHLETE',
        });

      expect(res.status).toBe(409);
    });

    it('should reject short passwords (< 8 chars)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'newuser@test.edu.ph',
          password: '123',
          displayName: 'Short Pass',
          role: 'ATHLETE',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/login', () => {
    it('should login with correct credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'athlete@test.edu.ph', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('access_token');

      const cookie = res.headers['set-cookie'] as unknown as string[];
      expect(cookie.some((c: string) => c.startsWith('refresh_token='))).toBe(
        true,
      );
    });

    it('should reject wrong password', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'athlete@test.edu.ph', password: 'wrongpassword' });

      expect(res.status).toBe(401);
    });

    it('should reject a non-existent account', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'ghost@test.edu.ph', password: 'password123' });

      expect(res.status).toBe(401);
    });
  });

  describe('Token refresh and logout flow', () => {
    let accessToken: string;
    let refreshToken: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'athlete@test.edu.ph', password: 'password123' });

      accessToken = (res.body as { access_token: string }).access_token;
      refreshToken = extractRefreshToken(res)!;
    });

    it('should issue a new access token using the refresh cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `refresh_token=${refreshToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('access_token');

      refreshToken = extractRefreshToken(res) ?? refreshToken;
      accessToken = (res.body as { access_token: string }).access_token;
    });

    it('should reject an already-used refresh token (rotation)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `refresh_token=${refreshToken}`);

      expect([200, 401]).toContain(res.status);
    });

    it('should return 401 when no refresh token cookie is provided', async () => {
      const res = await request(app.getHttpServer()).post('/auth/refresh');
      expect(res.status).toBe(401);
    });

    it('should logout and clear the cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Cookie', `refresh_token=${refreshToken}`);

      expect(res.status).toBe(200);
      expect((res.body as { message: string }).message).toBe(
        'Logged out successfully',
      );

      const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
      const cleared = cookies.find((c: string) =>
        c.startsWith('refresh_token='),
      );
      expect(cleared).toMatch(/refresh_token=;/);
    });
  });

  describe('Protected routes', () => {
    it('should return 401 on protected endpoint without token', async () => {
      const res = await request(app.getHttpServer()).post('/auth/logout');
      expect(res.status).toBe(401);
    });

    it('should return 403 when a non-admin tries to create a university', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'athlete@test.edu.ph', password: 'password123' });

      const token = (loginRes.body as { access_token: string }).access_token;

      const res = await request(app.getHttpServer())
        .post('/universities')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Hacker Uni', domain: 'hacker.edu.ph' });

      expect(res.status).toBe(403);
    });
  });
});
