import { NextResponse } from "next/server";

// Proxies AWS's public "elevation-tiles-prod" terrarium DEM tiles, which the
// map's Terrain map-type (hillshade) and 3D terrain need — that bucket sends
// no CORS headers, so the browser can't fetch it directly (this is the same
// gap the design prototype's dev-only serve-prototype.mjs worked around,
// which was never committed). DEM tiles never change, so responses are
// cached hard both at the edge/CDN and in the browser.
const DEM_SOURCE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

export async function GET(_request: Request, context: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await context.params;
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y.replace(/\.png$/, ""))) {
    return NextResponse.json({ error: "Invalid tile coordinates." }, { status: 400 });
  }

  const upstream = await fetch(`${DEM_SOURCE}/${z}/${x}/${y}`, { next: { revalidate: 604800 } });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Upstream tile fetch failed: ${upstream.status}` }, { status: upstream.status || 502 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
}
