import { IsNotEmpty, IsString } from 'class-validator';

export class AdvanceMatchDto {
  @IsNotEmpty()
  @IsString()
  winnerTeamId: string;

  @IsNotEmpty()
  @IsString()
  loserTeamId: string;
}
