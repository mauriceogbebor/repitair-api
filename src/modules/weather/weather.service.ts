import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type Condition = { text: string; code: number; icon: string };
type ProviderHour = { time_epoch: number; temp_c: number; chance_of_rain: number; wind_kph: number; condition: Condition };
type ProviderForecast = {
  location: { name: string; region: string; country: string; tz_id: string; localtime_epoch: number };
  current: { last_updated_epoch: number; temp_c: number; feelslike_c: number; humidity: number; wind_kph: number; precip_mm: number; condition: Condition };
  forecast: { forecastday: Array<{ date: string; day: { maxtemp_c: number; mintemp_c: number; daily_chance_of_rain: number }; hour: ProviderHour[] }> };
};

export type WeatherSnapshot = {
  location: { name: string; region: string; country: string; timeZone: string; localTimeEpoch: number };
  observedAt: string;
  fetchedAt: string;
  current: { temperatureC: number; feelsLikeC: number; humidityPercent: number; windKph: number; precipitationMm: number; condition: string; conditionCode: number; iconUrl: string };
  today: { highC: number; lowC: number; rainChancePercent: number };
  hourly: Array<{ timeEpoch: number; temperatureC: number; rainChancePercent: number; windKph: number; condition: string; conditionCode: number; iconUrl: string }>;
};

const CACHE_MS = 10 * 60 * 1000;
const CACHE_LIMIT = 200;
const UPSTREAM_TIMEOUT_MS = 8000;

function iconUrl(value: string): string {
  return value.startsWith("//cdn.weatherapi.com/") ? `https:${value}` : "";
}

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private readonly cache = new Map<string, { expiresAt: number; value: WeatherSnapshot }>();
  private readonly inFlight = new Map<string, Promise<WeatherSnapshot>>();

  constructor(private readonly config: ConfigService) {}

  async forecast(location: string): Promise<WeatherSnapshot> {
    const key = this.config.get<string>("WEATHERAPI_KEY")?.trim();
    if (!key) throw new ServiceUnavailableException("Weather is not configured.");
    const cacheKey = location.toLocaleLowerCase("en");
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const pending = this.inFlight.get(cacheKey);
    if (pending) return pending;

    const request = this.fetchForecast(location, key).then((value) => {
      if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_MS, value });
      return value;
    }).finally(() => this.inFlight.delete(cacheKey));
    this.inFlight.set(cacheKey, request);
    return request;
  }

  private async fetchForecast(location: string, key: string): Promise<WeatherSnapshot> {
    const url = new URL("https://api.weatherapi.com/v1/forecast.json");
    url.search = new URLSearchParams({ key, q: location, days: "2", aqi: "no", alerts: "no" }).toString();
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    } catch {
      throw new ServiceUnavailableException("Weather service is temporarily unavailable.");
    }
    if (response.status === 400) throw new BadGatewayException("Weather provider could not resolve this location.");
    if (!response.ok) {
      this.logger.warn(`Weather provider returned HTTP ${response.status}`);
      throw new ServiceUnavailableException("Weather service is temporarily unavailable.");
    }

    let data: ProviderForecast;
    try {
      data = await response.json() as ProviderForecast;
      if (!data.location?.name || !data.current?.condition || !data.forecast?.forecastday?.[0]) throw new Error("Invalid provider response");
    } catch {
      throw new BadGatewayException("Weather provider returned invalid data.");
    }
    const now = data.location.localtime_epoch;
    const hours = data.forecast.forecastday.flatMap((day) => day.hour ?? [])
      .filter((hour) => hour.time_epoch >= now - 3600).slice(0, 12);
    const today = data.forecast.forecastday[0].day;
    return {
      location: { name: data.location.name, region: data.location.region, country: data.location.country, timeZone: data.location.tz_id, localTimeEpoch: now },
      observedAt: new Date(data.current.last_updated_epoch * 1000).toISOString(),
      fetchedAt: new Date().toISOString(),
      current: { temperatureC: data.current.temp_c, feelsLikeC: data.current.feelslike_c, humidityPercent: data.current.humidity, windKph: data.current.wind_kph, precipitationMm: data.current.precip_mm, condition: data.current.condition.text, conditionCode: data.current.condition.code, iconUrl: iconUrl(data.current.condition.icon) },
      today: { highC: today.maxtemp_c, lowC: today.mintemp_c, rainChancePercent: today.daily_chance_of_rain },
      hourly: hours.map((hour) => ({ timeEpoch: hour.time_epoch, temperatureC: hour.temp_c, rainChancePercent: hour.chance_of_rain, windKph: hour.wind_kph, condition: hour.condition.text, conditionCode: hour.condition.code, iconUrl: iconUrl(hour.condition.icon) })),
    };
  }
}
