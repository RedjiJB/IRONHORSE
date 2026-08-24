// Human-readable weather for a site, for the "what's the weather at my
// site today" WhatsApp query -- a different shape than
// exceptions.ts's fetchOpenMeteoForecast, which only pulls the two
// threshold fields (precip probability, max windspeed) the exceptions
// engine needs to decide whether to raise an alert. Same endpoint, same
// sovereignty-tier decision (policy/sovereignty_tiers.yaml's
// weather_forecast entry, already external_accepted) -- reused, not
// duplicated in spirit, just a different response shape for a different
// consumer.
const WEATHER_CODE_SUMMARY: Record<number, string> = {
  0: "clear sky",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "depositing rime fog",
  51: "light drizzle",
  53: "moderate drizzle",
  55: "dense drizzle",
  61: "slight rain",
  63: "moderate rain",
  65: "heavy rain",
  71: "slight snow",
  73: "moderate snow",
  75: "heavy snow",
  80: "slight rain showers",
  81: "moderate rain showers",
  82: "violent rain showers",
  95: "thunderstorm",
  96: "thunderstorm with slight hail",
  99: "thunderstorm with heavy hail",
};

export type SiteWeatherSummary = {
  summary: string;
  tempMaxC: number;
  tempMinC: number;
  precipitationProbabilityMax: number;
  windSpeedMaxKmh: number;
};

export type FetchSiteWeather = (lat: number, lng: number) => Promise<SiteWeatherSummary | null>;

export const fetchSiteWeather: FetchSiteWeather = async (lat, lng) => {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max,weathercode&forecast_days=1&timezone=auto`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      daily?: {
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: number[];
        windspeed_10m_max?: number[];
        weathercode?: number[];
      };
    };
    const tempMaxC = data.daily?.temperature_2m_max?.[0];
    const tempMinC = data.daily?.temperature_2m_min?.[0];
    const precip = data.daily?.precipitation_probability_max?.[0];
    const wind = data.daily?.windspeed_10m_max?.[0];
    const code = data.daily?.weathercode?.[0];
    if (tempMaxC == null || tempMinC == null || precip == null || wind == null) return null;
    return {
      summary: (code != null && WEATHER_CODE_SUMMARY[code]) || "unknown conditions",
      tempMaxC,
      tempMinC,
      precipitationProbabilityMax: precip,
      windSpeedMaxKmh: wind,
    };
  } catch {
    return null;
  }
};
