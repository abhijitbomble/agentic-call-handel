import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/call"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("voiceops_token")?.value;
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(path + "/"));
  const isStatic = pathname.startsWith("/_next") || pathname.startsWith("/favicon");
  const isCustomerCall = pathname.startsWith("/call/");

  if (isStatic) return NextResponse.next();

  if (isCustomerCall) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-is-customer-call", "true");
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (!token && !isPublic) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (token && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (pathname === "/login") {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-skip-app-shell", "true");
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

