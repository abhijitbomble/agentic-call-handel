import { backendRequest } from "@/lib/backend-proxy";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const data = await backendRequest("/squad/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start squad session";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
