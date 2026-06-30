import { NextResponse } from "next/server";

import { backendRequest } from "@/lib/backend-proxy";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const payload = await request.json();
    const response = await backendRequest(`/callbacks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }, request.headers.get("cookie"));
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update callback" },
      { status: 500 },
    );
  }
}
