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
  gameHandle: string;

  @IsString()
  @IsOptional()
  preferredRole?: string;
}

export class JoinTeamDto {
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
