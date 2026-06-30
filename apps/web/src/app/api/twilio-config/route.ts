import { backendRequest, BackendRequestError, MissingSessionError } from "@/lib/backend-proxy";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const data = await backendRequest("/twilio/config");
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof MissingSessionError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof BackendRequestError) {
      return NextResponse.json(error.payload ?? { error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load Twilio config" }, { status: 500 });
  }
}

