import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { GameTitle } from '@prisma/client';

export class CreateTeamDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(GameTitle)
  gameTitle: GameTitle;

  @IsString()
  @IsNotEmpty()
  universityId: string;

  @IsString()
  @IsNotEmpty()
  captainId: string;

  @IsString()
  @IsNotEmpty()
  gameHandle: string;

  @IsString()
  @IsOptional()
  preferredRole?: string;
}

export class JoinTeamDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  gameHandle: string;

  @IsString()
  @IsOptional()
  preferredRole?: string;

  @IsString()
  @IsOptional()
  inviteCode?: string;
}
