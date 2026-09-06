import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { GameTitle } from '@prisma/client';

export class UpdateGameHandleDto {
  @ApiProperty({ enum: GameTitle, example: GameTitle.VALORANT })
  @IsEnum(GameTitle)
  @IsNotEmpty()
  gameTitle: GameTitle;

  @ApiProperty({ example: 'TenZ#NA1' })
  @IsString()
  @IsNotEmpty()
  handle: string;
}
