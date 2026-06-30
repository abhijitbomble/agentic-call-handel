import { NextResponse } from "next/server";

import { BackendRequestError, backendRequest } from "@/lib/backend-proxy";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const data = await backendRequest<unknown>(`/campaigns/${id}/start`, { method: "POST", body: "{}" }, request.headers.get("cookie"));
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof BackendRequestError) {
      return NextResponse.json(error.payload ?? { error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}

