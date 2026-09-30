import { Type } from 'class-transformer';
import { MatchGameMode } from '@prisma/client';
import {
  ArrayMinSize,
  IsEnum,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class ClosePlayerStatDto {
  @IsUUID()
  universityId: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsInt()
  @Min(0)
  kills: number;

  @IsInt()
  @Min(0)
  deaths: number;

  @IsInt()
  @Min(0)
  assists: number;

  @IsOptional()
  @IsObject()
  extra?: Record<string, unknown>;
}

export class CloseGameDto {
  @IsInt()
  @Min(1)
  gameNumber: number;

  @IsOptional()
  @IsEnum(MatchGameMode)
  mode?: MatchGameMode;

  @IsUUID()
  winnerId: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  winnerScore?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  loserScore?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClosePlayerStatDto)
  players?: ClosePlayerStatDto[];
}

export class CloseMatchDto {
  @IsOptional()
  @IsUUID()
  winnerId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ClosePlayerStatDto)
  players?: ClosePlayerStatDto[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CloseGameDto)
  games?: CloseGameDto[];
}
