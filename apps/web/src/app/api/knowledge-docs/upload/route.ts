import { type NextRequest, NextResponse } from "next/server";
import { backendRequest } from "@/lib/backend-proxy";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const cookie = request.headers.get("cookie");
    const result = await backendRequest(
      "/knowledge-docs/upload",
      {
        method: "POST",
        body: formData,
      },
      cookie,
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
