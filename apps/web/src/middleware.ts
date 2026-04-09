import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Read auth from localStorage is not possible in middleware —
  // we use a cookie set by the client after login
  const authCookie = request.cookies.get("studiq-auth-storage");
  let user: { role?: string } | null = null;

  if (authCookie?.value) {
    try {
      const parsed = JSON.parse(decodeURIComponent(authCookie.value));
      user = parsed?.state?.user ?? null;
    } catch {
      // ignore parse errors
    }
  }

  const isAuthenticated = !!user;
  const role = user?.role;

  // Redirect unauthenticated users to login
  if (
    !isAuthenticated &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/register")
  ) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect wrong-role users
  if (isAuthenticated) {
    if (pathname.startsWith("/teacher") && role !== "teacher") {
      return NextResponse.redirect(new URL("/student/dashboard", request.url));
    }
    if (pathname.startsWith("/student") && role !== "student") {
      return NextResponse.redirect(new URL("/teacher/dashboard", request.url));
    }

    // Redirect root to appropriate dashboard
    if (pathname === "/") {
      return NextResponse.redirect(
        new URL(
          role === "teacher" ? "/teacher/dashboard" : "/student/dashboard",
          request.url
        )
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api).*)",
  ],
};
