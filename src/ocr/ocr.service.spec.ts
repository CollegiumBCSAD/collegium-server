import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OcrService } from './ocr.service';

const mockConfigService = {
  get: jest.fn((key: string) =>
    key === 'OCR_SERVICE_URL' ? 'http://localhost:8000' : undefined,
  ),
};

function ocrReply(body: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('OcrService', () => {
  let service: OcrService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OcrService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<OcrService>(OcrService);
    jest.clearAllMocks();
  });

  it('normalizes players, coerces stats, and keeps unicode IGNs', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      ocrReply({
        players: [
          {
            ign: 'LWS ズシンティラ',
            team: 'blue',
            kills: 9,
            deaths: '11',
            assists: -3,
            extra: { gold: 12315 },
          },
        ],
      }),
    );

    const result = await service.recognize(
      Buffer.from('img'),
      'image/jpeg',
      'shot.jpg',
      'MLBB',
    );

    expect(result.game).toBe('MLBB');
    expect(result.players[0]).toEqual({
      ign: 'LWS ズシンティラ',
      team: 'blue',
      kills: 9,
      deaths: 11,
      assists: 0,
      extra: { gold: 12315 },
    });
  });

  it('throws when OCR_SERVICE_URL is not configured', async () => {
    mockConfigService.get.mockReturnValueOnce(undefined);
    global.fetch = jest.fn();

    await expect(
      service.recognize(Buffer.from('img'), 'image/jpeg', 'a.jpg', 'LOL'),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws when the OCR service returns a non-ok status', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('boom'),
    });

    await expect(
      service.recognize(Buffer.from('img'), 'image/jpeg', 'a.jpg', 'VALORANT'),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('throws when the response is missing a players array', async () => {
    global.fetch = jest.fn().mockResolvedValue(ocrReply({ nope: true }));

    await expect(
      service.recognize(Buffer.from('img'), 'image/jpeg', 'a.jpg', 'CODM'),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
