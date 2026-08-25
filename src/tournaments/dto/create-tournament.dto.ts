import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTournamentDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  image?: string;
}
