import { Module } from "@nestjs/common";
import { ScrimsController } from "./scrims.controller";
import { ScrimsService } from "./scrims.service";

@Module({
  controllers: [ScrimsController],
  providers: [ScrimsService],
  exports: [ScrimsService],
})
export class ScrimsModule {}
