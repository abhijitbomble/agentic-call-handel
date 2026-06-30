import { NextResponse } from "next/server";

import { backendRequest } from "@/lib/backend-proxy";

type RouteContext = {
  params: Promise<{ callId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { callId } = await context.params;

  try {
    const payload = await request.json();
    const response = await backendRequest(`/voice/sessions/${callId}/turns`, {
      method: "POST",
      body: JSON.stringify(payload),
    }, request.headers.get("cookie"));
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to process turn" },
      { status: 500 },
    );
  }
}

