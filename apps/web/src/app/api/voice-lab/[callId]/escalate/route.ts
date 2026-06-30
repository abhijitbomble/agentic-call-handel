import { backendRequest } from "@/lib/backend-proxy";
import { NextRequest, NextResponse } from "next/server";

type RouteContext = { params: Promise<{ callId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { callId } = await context.params;
  try {
    const payload = await request.json();
    const response = await backendRequest(
      `/calls/${callId}/escalate`,
      { method: "POST", body: JSON.stringify(payload) },
      request.headers.get("cookie"),
    );
    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Escalation failed" },
      { status: 500 },
    );
  }
}
