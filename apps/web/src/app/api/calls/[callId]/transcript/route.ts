import { NextResponse } from "next/server";

import { backendRequest } from "@/lib/backend-proxy";

type RouteContext = { params: Promise<{ callId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { callId } = await context.params;
  try {
    const transcript = await backendRequest(`/calls/${callId}/transcript`, {}, request.headers.get("cookie"));
    return NextResponse.json(transcript);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to fetch transcript" },
      { status: 500 },
    );
  }
}
