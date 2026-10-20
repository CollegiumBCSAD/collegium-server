import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export class CreateTournamentStreamDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsUrl({ require_protocol: true })
  url: string;

  // Shown on the stream tile, e.g. "Main stage" or "Court B".
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(60)
  label?: string | null;

  // The match this stream is showing right now.
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  matchId?: string | null;

  @IsOptional()
  @IsBoolean()
  isLive?: boolean;
}

export class UpdateTournamentStreamDto extends PartialType(
  CreateTournamentStreamDto,
) {}
