import { Controller, Get } from "@nestjs/common";
import { Public } from "../../common/decorators/roles.decorator";
import { HealthService } from "./health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  getHealth() {
    return this.healthService.getStatus();
  }
}
