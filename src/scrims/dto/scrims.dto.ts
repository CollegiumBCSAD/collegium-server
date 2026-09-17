import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsDateString,
  IsArray,
  IsNumber,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { GameTitle } from '@prisma/client';

export class CreateScrimDto {
  @IsString()
  @IsNotEmpty()
  teamId!: string;

  @IsEnum(GameTitle)
  gameTitle!: GameTitle;

  @IsDateString()
  scheduledAt!: string;

  @IsString()
  @IsNotEmpty()
  format!: string;

  @IsString()
  @IsOptional()
  rankRange?: string;

  @IsString()
  @IsOptional()
  mapPreference?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class AcceptScrimDto {
  @IsString()
  @IsNotEmpty()
  opponentId!: string;
}

export class SendScrimChatDto {
  @IsString()
  @IsNotEmpty()
  text!: string;
}

export class ScrimPlayerStatDto {
  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsOptional()
  universityId?: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsNumber()
  kills!: number;

  @IsNumber()
  deaths!: number;

  @IsNumber()
  assists!: number;

  @IsOptional()
  @IsNumber()
  combatScore?: number;

  @IsOptional()
  @IsNumber()
  headshotPct?: number;

  @IsOptional()
  @IsString()
  agentName?: string;
}

export class FinalizeScrimDto {
  @IsString()
  @IsNotEmpty()
  winnerId!: string;

  @IsString()
  @IsOptional()
  loserId?: string;

  @IsOptional()
  @IsNumber()
  gameDuration?: number;

  // Without @ValidateNested + @Type, the global ValidationPipe's
  // forbidNonWhitelisted rejects this property outright ("property players
  // should not exist"), since class-validator only recognizes decorated
  // properties as known.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScrimPlayerStatDto)
  players!: ScrimPlayerStatDto[];
}
