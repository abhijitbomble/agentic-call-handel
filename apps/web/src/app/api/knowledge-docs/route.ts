import { type NextRequest, NextResponse } from "next/server";
import { backendRequest } from "@/lib/backend-proxy";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const cookie = request.headers.get("cookie");
    const result = await backendRequest("/knowledge-docs", {
      method: "POST",
      body: JSON.stringify(body),
    }, cookie);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
