import { backendRequest } from "@/lib/backend-proxy";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = await backendRequest("/customer-sessions", {
      method: "POST",
      body: JSON.stringify(body),
    }, request.headers.get("cookie"));
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create session" },
      { status: 500 },
    );
  }
}
