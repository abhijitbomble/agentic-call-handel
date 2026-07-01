import { type NextRequest, NextResponse } from "next/server";
import { backendRequest } from "@/lib/backend-proxy";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const cookie = request.headers.get("cookie");
    const result = await backendRequest(`/programs/${params.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }, cookie);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
