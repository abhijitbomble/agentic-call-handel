import { backendRequest, BackendRequestError, MissingSessionError } from "@/lib/backend-proxy";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const queueId = request.nextUrl.searchParams.get("queue_id");
  if (!queueId) {
    return NextResponse.json({ error: "queue_id is required" }, { status: 400 });
  }

  try {
    const data = await backendRequest(`/twilio/browser/token?queue_id=${encodeURIComponent(queueId)}`, {}, request.headers.get("cookie"));
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof MissingSessionError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof BackendRequestError) {
      const payload = error.payload && typeof error.payload === "object" ? error.payload : { error: error.message };
      return NextResponse.json(payload, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create browser token" }, { status: 500 });
  }
}
