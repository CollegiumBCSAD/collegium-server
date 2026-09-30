import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { BracketFormat, GameTitle } from '@prisma/client';

export class UpdateTournamentDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty()
  @IsString()
  name?: string;

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
  @IsIn([1, 3, 5, 7])
  bestOfEarly?: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 3, 5, 7])
  bestOfLate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 3, 5, 7])
  bestOfFinal?: number;

  @IsOptional()
  @IsIn([BracketFormat.SINGLE_ELIM, BracketFormat.DOUBLE_ELIM])
  playoffBracket?: BracketFormat;

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

  @IsOptional()
  @IsString()
  reapply?: string;
}
