import { backendRequest } from "@/lib/backend-proxy";
import { NextRequest, NextResponse } from "next/server";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  try {
    const data = await backendRequest(`/squad/sessions/${callId}/close`, { method: "POST" });
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to close session";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
