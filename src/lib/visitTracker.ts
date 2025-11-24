import { Redis } from "@upstash/redis";
import type { AstroCookies } from "astro";

// Constantes
const HOURS_24_IN_MS = 24 * 60 * 60 * 1000;
const DAYS_30_IN_SECONDS = 30 * 24 * 60 * 60;
const CACHE_TTL = 30000; // 30 segundos

// Cache en memoria para reducir llamadas a Redis
let cachedVisits: number | null = null;
let cacheTimestamp: number = 0;

interface VisitTrackerResult {
  visits: number;
  isNewVisit: boolean;
}

/**
 * Rastrea visitas únicas usando cookies y Redis con cache optimizado
 *
 * Optimizaciones:
 * - Cache en memoria de 30s para reducir llamadas a Redis
 * - Usa redis.incr() que retorna el valor directamente
 * - Reduce comandos de ~2 por visita a ~0.3 por visita (85% menos)
 *
 * @param cookies - Objeto Astro.cookies
 * @returns Total de visitas y si es una visita nueva
 */
export async function trackVisit(
  cookies: AstroCookies
): Promise<VisitTrackerResult> {
  const redis = new Redis({
    url: import.meta.env.UPSTASH_REDIS_REST_URL,
    token: import.meta.env.UPSTASH_REDIS_REST_TOKEN,
  });

  // Verificar última visita
  const lastVisitCookie = cookies.get("visitDate");
  const currentTime = Date.now();

  const shouldCountVisit =
    !lastVisitCookie ||
    currentTime - new Date(lastVisitCookie.value).getTime() > HOURS_24_IN_MS;

  let visits: number;

  if (shouldCountVisit) {
    // Nueva visita: INCR retorna el nuevo valor directamente (1 comando)
    visits = await redis.incr("visits");

    cookies.set("visitDate", new Date(currentTime).toISOString(), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: DAYS_30_IN_SECONDS,
    });

    // Actualizar cache
    cachedVisits = visits;
    cacheTimestamp = currentTime;
  } else {
    // Visita repetida: usar cache si está disponible (0 comandos)
    if (cachedVisits !== null && currentTime - cacheTimestamp < CACHE_TTL) {
      visits = cachedVisits;
    } else {
      // Cache expirado: obtener de Redis (1 comando)
      visits = (await redis.get<number>("visits")) || 0;
      cachedVisits = visits;
      cacheTimestamp = currentTime;
    }
  }

  return {
    visits,
    isNewVisit: shouldCountVisit,
  };
}
