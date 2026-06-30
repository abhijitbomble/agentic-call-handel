import { type NextRequest, NextResponse } from "next/server";
import { BackendRequestError, backendRequest } from "@/lib/backend-proxy";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const cookie = request.headers.get("cookie");
    const result = await backendRequest("/customers", {
      method: "POST",
      body: JSON.stringify(body),
    }, cookie);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BackendRequestError) {
      return NextResponse.json(err.payload ?? { error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

