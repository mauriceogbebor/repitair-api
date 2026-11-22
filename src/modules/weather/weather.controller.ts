import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { WeatherService } from "./weather.service";

@Controller("weather")
@UseGuards(JwtAuthGuard)
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  @Get("forecast")
  forecast(@Query("q") rawLocation?: string) {
    const location = rawLocation?.trim();
    if (!location || location.length > 100 || /[\x00-\x1f<>]/.test(location)) {
      throw new BadRequestException("Enter a valid location (city or latitude,longitude).");
    }
    return this.weather.forecast(location);
  }
}
