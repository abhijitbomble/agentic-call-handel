import { NextResponse } from "next/server";

const API_BASE_URL =
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://127.0.0.1:8020";

export async function POST(request: Request) {
  try {
    const { username, password } = (await request.json()) as { username: string; password: string };
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }
    const payload = (await response.json()) as {
      access_token: string;
      role: string;
      organization_id: string;
      client_program_id: string | null;
    };
    const res = NextResponse.json({ role: payload.role, organization_id: payload.organization_id });
    res.cookies.set("voiceops_token", payload.access_token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    return res;
  } catch {
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
