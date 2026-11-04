import { ArrayMaxSize, ArrayMinSize, IsArray } from 'class-validator';

export class ManualBracketDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(256)
  slots: (string | null)[];
}
