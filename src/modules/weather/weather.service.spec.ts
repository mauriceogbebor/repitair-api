import { ConfigService } from "@nestjs/config";

import { WeatherService } from "./weather.service";

describe("WeatherService", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

  it("normalizes provider data and shares cached results without exposing the key", async () => {
    const service = new WeatherService({ get: () => "private-test-key" } as unknown as ConfigService);
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
      location: { name: "Cape Town", region: "Western Cape", country: "South Africa", tz_id: "Africa/Johannesburg", localtime_epoch: 2000 },
      current: { last_updated_epoch: 1900, temp_c: 16, feelslike_c: 14, humidity: 70, wind_kph: 12, precip_mm: 0, condition: { text: "Overcast", code: 1009, icon: "//cdn.weatherapi.com/weather/64x64/day/122.png" } },
      forecast: { forecastday: [{ day: { maxtemp_c: 18, mintemp_c: 12, daily_chance_of_rain: 40 }, hour: [{ time_epoch: 3600, temp_c: 17, chance_of_rain: 30, wind_kph: 11, condition: { text: "Cloudy", code: 1006, icon: "//cdn.weatherapi.com/weather/64x64/day/119.png" } }] }] },
    }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = await service.forecast("Cape Town");
    const second = await service.forecast("cape town");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first.current).toMatchObject({ temperatureC: 16, condition: "Overcast", iconUrl: "https://cdn.weatherapi.com/weather/64x64/day/122.png" });
    expect(first.today).toEqual({ highC: 18, lowC: 12, rainChancePercent: 40 });
    expect(JSON.stringify(first)).not.toContain("private-test-key");
  });
});
