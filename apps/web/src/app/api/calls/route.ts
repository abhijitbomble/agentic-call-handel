import { NextResponse } from "next/server";

import { backendRequest } from "@/lib/backend-proxy";

export async function GET(request: Request) {
  try {
    const cookieHeader = request.headers.get("cookie");
    const calls = await backendRequest<unknown[]>("/calls", {}, cookieHeader);
    return NextResponse.json(calls);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to fetch calls" },
      { status: 500 },
    );
  }
}
