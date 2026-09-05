import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { GameTitle } from '@prisma/client';

export class UpdateTournamentDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  name?: string;

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

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  reapply?: string;
}
