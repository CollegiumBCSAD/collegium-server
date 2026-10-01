import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class ReportEventResultDto {
  @IsString()
  @IsNotEmpty()
  winnerId!: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  scoreA?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  scoreB?: number;
}
