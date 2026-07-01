import { type NextRequest, NextResponse } from "next/server";
import { backendRequest } from "@/lib/backend-proxy";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const cookie = request.headers.get("cookie");
    const result = await backendRequest(`/programs/${id}/policy/runtime`, undefined, cookie);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
