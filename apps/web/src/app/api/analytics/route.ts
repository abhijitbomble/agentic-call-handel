import { NextResponse } from "next/server";

import { backendRequest, BackendRequestError, MissingSessionError } from "@/lib/backend-proxy";

export async function GET(request: Request) {
  try {
    const cookieHeader = request.headers.get("cookie");
    const data = await backendRequest<unknown>("/analytics/overview", {}, cookieHeader);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof MissingSessionError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof BackendRequestError) {
      return NextResponse.json(error.payload ?? { error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to fetch analytics" },
      { status: 500 },
    );
  }
}

