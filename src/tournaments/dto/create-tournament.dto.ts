import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { GameTitle } from '@prisma/client';

export class CreateTournamentDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsEnum(GameTitle)
  gameTitle?: GameTitle;

  @IsOptional()
  @IsString()
  bracketFormat?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  teamQuota?: number;

  @IsOptional()
  @IsString()
  rules?: string;
}
