import { IsString, IsNotEmpty, IsEnum, IsOptional, IsDateString } from "class-validator";
import { GameTitle } from "@prisma/client";

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
