import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GameTitle } from '@prisma/client';
import { ScannedPlayer, ScanResult } from './ocr.types';

@Injectable()
export class OcrService {
  constructor(private readonly configService: ConfigService) {}

  async recognize(
    image: Buffer,
    mimeType: string,
    filename: string,
    game: GameTitle,
  ): Promise<ScanResult> {
    const baseUrl = this.configService.get<string>('OCR_SERVICE_URL');
    if (!baseUrl) {
      throw new InternalServerErrorException(
        'OCR_SERVICE_URL is not configured',
      );
    }

    const form = new FormData();
    form.append('game', game);
    form.append(
      'image',
      new Blob([new Uint8Array(image)], { type: mimeType }),
      filename || 'screenshot',
    );

    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, '')}/ocr/scan`, {
        method: 'POST',
        body: form,
      });
    } catch {
      throw new InternalServerErrorException('Failed to reach the OCR service');
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new InternalServerErrorException(
        `OCR service error ${response.status}: ${detail.slice(0, 200)}`,
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new InternalServerErrorException(
        'OCR service returned invalid JSON',
      );
    }

    return { game, players: normalizePlayers(data) };
  }
}

function normalizePlayers(data: unknown): ScannedPlayer[] {
  const players = (data as { players?: unknown })?.players;
  if (!Array.isArray(players)) {
    throw new InternalServerErrorException(
      'OCR service response is missing a players array',
    );
  }

  return players.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      ign: typeof row.ign === 'string' ? row.ign : '',
      team: typeof row.team === 'string' ? row.team : null,
      kills: toCount(row.kills),
      deaths: toCount(row.deaths),
      assists: toCount(row.assists),
      extra: isRecord(row.extra) ? row.extra : {},
    };
  });
}

function toCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
