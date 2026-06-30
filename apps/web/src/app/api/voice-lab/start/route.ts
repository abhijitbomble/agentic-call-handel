import { NextResponse } from "next/server";

import { backendRequest } from "@/lib/backend-proxy";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const response = await backendRequest("/voice/sessions", {
      method: "POST",
      body: JSON.stringify(payload),
    }, request.headers.get("cookie"));
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start session" },
      { status: 500 },
    );
  }
}
