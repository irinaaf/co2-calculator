/**
 * GET /api/geocode?q=<query>
 *
 * Proxies requests to Entur Geocoder API with ET-Client-Name header.
 * Returns up to 6 place suggestions for Norway.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import type { PlaceSuggestion } from "@/components/PlaceInput";

const CLIENT_NAME = "portfolio-co2-calculator";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PlaceSuggestion[] | { error: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) {
    return res.status(200).json([]);
  }

  const params = new URLSearchParams({
    text: q,
    size: "6",
    lang: "no",
    "boundary.country_code": "NO",
  });

  const url = `https://api.entur.io/geocoder/v1/autocomplete?${params}`;

  try {
    const upstream = await fetch(url, {
      headers: { "ET-Client-Name": CLIENT_NAME },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: "Geocoder upstream error" });
    }

    interface RawGeoFeature {
      properties: { label: string; layer: string };
      geometry: { coordinates: [number, number] };
    }

    const json = await upstream.json();
    const features: RawGeoFeature[] = json.features ?? [];

    const suggestions: PlaceSuggestion[] = features.map((f) => ({
      label: f.properties.label,
      layer: f.properties.layer,
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
    }));

    // Cache for 5 minutes — geocoder results are stable
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
    return res.status(200).json(suggestions);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}
