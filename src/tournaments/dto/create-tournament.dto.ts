import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { BracketFormat, GameTitle } from '@prisma/client';

export class CreateTournamentDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsEnum(GameTitle)
  gameTitle?: GameTitle;

  @IsOptional()
  @IsEnum(BracketFormat)
  bracketFormat?: BracketFormat;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  playoffTeamCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  teamQuota?: number;

  @IsOptional()
  @IsString()
  rules?: string;

  @IsOptional()
  @IsString()
  startDate?: string;
}
