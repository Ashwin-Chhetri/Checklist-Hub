import { NextResponse } from "next/server";
import { searchBackbone } from "@/lib/taxonomy/backbone.server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";

  if (q.trim().length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  const suggestions = searchBackbone(q, 8);
  return NextResponse.json({ suggestions });
}
