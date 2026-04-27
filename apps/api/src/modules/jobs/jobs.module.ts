import { Module } from "@nestjs/common";
import { jobRegistry } from "./jobs.registry";

@Module({
  providers: [
    {
      provide: "JOB_REGISTRY",
      useValue: jobRegistry
    }
  ],
  exports: ["JOB_REGISTRY"]
})
export class JobsModule {}
