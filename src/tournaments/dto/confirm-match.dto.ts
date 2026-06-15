import { IsNotEmpty, IsString } from 'class-validator';

export class ConfirmMatchDto {
  @IsNotEmpty()
  @IsString()
  riotMatchId: string;
}
