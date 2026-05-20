/**
 * lib/routing.ts — абстракция для расчёта дорожного расстояния.
 *
 * Сейчас использует OSRM (бесплатный, без ключа).
 * Чтобы переключиться на Google Maps Distance Matrix API:
 *
 *   1. Установи переменную окружения: ROUTING_PROVIDER=google
 *   2. Добавь ключ: GOOGLE_MAPS_API_KEY=your_key
 *   3. Всё остальное — без изменений.
 *
 * Поддерживаемые провайдеры:
 *   - "osrm"   — публичный OSRM (router.project-osrm.org), без ключа
 *   - "google" — Google Maps Distance Matrix API, требует GOOGLE_MAPS_API_KEY
 */

export interface RouteInfo {
  /** Дорожное расстояние в км */
  distanceKm: number;
  /** Примерное время в пути на авто в минутах */
  durationMinutes: number;
  /** Провайдер, который посчитал маршрут */
  provider: "osrm" | "google" | "fallback";
}

// ─────────────────────────────────────────────────────────────────
// Единственная публичная функция
// ─────────────────────────────────────────────────────────────────

/**
 * Получить дорожное расстояние между двумя точками.
 * Автоматически выбирает провайдера по ROUTING_PROVIDER env.
 * При ошибке любого провайдера падает на haversine × 1.25 (fallback).
 */
export async function getRoadDistance(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): Promise<RouteInfo> {
  const provider = process.env.ROUTING_PROVIDER ?? "osrm";

  try {
    if (provider === "google") {
      return await getDistanceGoogle(fromLat, fromLon, toLat, toLon);
    }
    return await getDistanceOsrm(fromLat, fromLon, toLat, toLon);
  } catch (err) {
    console.warn("[routing] Provider failed, using haversine fallback:", err);
    return fallback(fromLat, fromLon, toLat, toLon);
  }
}

// ─────────────────────────────────────────────────────────────────
// OSRM (free, no key)
// router.project-osrm.org — public demo server
// For production: self-host or use a paid OSRM instance
// ─────────────────────────────────────────────────────────────────

async function getDistanceOsrm(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): Promise<RouteInfo> {
  // OSRM coordinate order: lon,lat
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${fromLon},${fromLat};${toLon},${toLat}` +
    `?overview=false&annotations=false`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);

  const json = await res.json();
  if (json.code !== "Ok" || !json.routes?.length) {
    throw new Error(`OSRM: no route found (code=${json.code})`);
  }

  return {
    distanceKm:      parseFloat((json.routes[0].distance / 1000).toFixed(1)),
    durationMinutes: Math.round(json.routes[0].duration / 60),
    provider: "osrm",
  };
}

// ─────────────────────────────────────────────────────────────────
// Google Maps Distance Matrix API
// Swap in by setting: ROUTING_PROVIDER=google + GOOGLE_MAPS_API_KEY
// ─────────────────────────────────────────────────────────────────

async function getDistanceGoogle(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): Promise<RouteInfo> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY is not set");

  const params = new URLSearchParams({
    origins:      `${fromLat},${fromLon}`,
    destinations: `${toLat},${toLon}`,
    mode:         "driving",
    units:        "metric",
    key,
  });

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`Google Maps HTTP ${res.status}`);

  const json = await res.json();
  if (json.status !== "OK") throw new Error(`Google Maps: ${json.status}`);

  const element = json.rows?.[0]?.elements?.[0];
  if (element?.status !== "OK") {
    throw new Error(`Google Maps element: ${element?.status}`);
  }

  return {
    distanceKm:      parseFloat((element.distance.value / 1000).toFixed(1)),
    durationMinutes: Math.round(element.duration.value / 60),
    provider: "google",
  };
}

// ─────────────────────────────────────────────────────────────────
// Fallback: haversine × 1.25
// ─────────────────────────────────────────────────────────────────

function fallback(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): RouteInfo {
  const R = 6371;
  const dLat = ((toLat - fromLat) * Math.PI) / 180;
  const dLon = ((toLon - fromLon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((fromLat * Math.PI) / 180) *
      Math.cos((toLat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const straightKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const roadKm = parseFloat((straightKm * 1.25).toFixed(1));

  return {
    distanceKm:      roadKm,
    durationMinutes: Math.round((roadKm / 80) * 60), // avg 80 km/h
    provider: "fallback",
  };
}
