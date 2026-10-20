import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BracketFormat, EventStatus, GameTitle } from '@prisma/client';

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(GameTitle)
  gameTitle!: GameTitle;

  @IsEnum(BracketFormat)
  @IsOptional()
  bracketFormat?: BracketFormat;

  @IsDateString()
  @IsOptional()
  signupsCloseAt?: string;

  @IsString()
  @IsOptional()
  rules?: string;

  @IsInt()
  @Min(0)
  @Max(5)
  @IsOptional()
  maxSubs?: number;
}

export class UpdateEventDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @IsEnum(BracketFormat)
  @IsOptional()
  bracketFormat?: BracketFormat;

  @IsEnum(EventStatus)
  @IsOptional()
  status?: EventStatus;

  @IsDateString()
  @IsOptional()
  signupsCloseAt?: string;

  @IsString()
  @IsOptional()
  rules?: string;

  @IsInt()
  @Min(0)
  @Max(5)
  @IsOptional()
  maxSubs?: number;
}

export class ReviewEventDto {
  @IsBoolean()
  approve!: boolean;

  // Required when rejecting, so the organizer knows what to fix.
  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;
}
