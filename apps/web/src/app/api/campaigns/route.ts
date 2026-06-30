import { NextResponse } from "next/server";

import { BackendRequestError, backendRequest } from "@/lib/backend-proxy";

export async function GET(request: Request) {
  try {
    const data = await backendRequest<unknown[]>("/campaigns", {}, request.headers.get("cookie"));
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof BackendRequestError) {
      return NextResponse.json(error.payload ?? { error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = await backendRequest<unknown>("/campaigns", { method: "POST", body: JSON.stringify(body) }, request.headers.get("cookie"));
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof BackendRequestError) {
      return NextResponse.json(error.payload ?? { error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}

