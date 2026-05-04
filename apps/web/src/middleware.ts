import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Read user info from the non-HttpOnly cookie
  const userCookie = request.cookies.get("studiq-user");
  let user: { role?: string; status?: string } | null = null;

  if (userCookie?.value) {
    try {
      user = JSON.parse(decodeURIComponent(userCookie.value));
    } catch {
      // ignore parse errors
    }
  }

  const isAuthenticated = !!user;
  const role = user?.role;
  // Treat unset status as approved (legacy users / migrated rows).
  const status = user?.status ?? "approved";

  // Public routes that don't require authentication
  const isPublicRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/auth/callback") ||
    pathname.startsWith("/auth/set-password") ||
    pathname.startsWith("/auth/pending") ||
    pathname.startsWith("/forgot-password");

  // Redirect unauthenticated users to login
  if (!isAuthenticated && !isPublicRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isAuthenticated) {
    // Pending users are routed exclusively to /auth/pending until approved.
    // The API auth middleware enforces the same gate server-side, so client
    // routing is just a UX nicety, not the security boundary.
    if (status === "pending" && !pathname.startsWith("/auth/pending")) {
      return NextResponse.redirect(new URL("/auth/pending", request.url));
    }
    // An approved user landing on /auth/pending → push them to their dashboard.
    if (status === "approved" && pathname.startsWith("/auth/pending")) {
      return NextResponse.redirect(
        new URL(
          role === "teacher" ? "/teacher/dashboard" : "/student/map",
          request.url
        )
      );
    }

    // Redirect wrong-role users
    if (pathname.startsWith("/teacher") && role !== "teacher") {
      return NextResponse.redirect(new URL("/student/map", request.url));
    }
    if (pathname.startsWith("/student") && role !== "student") {
      return NextResponse.redirect(new URL("/teacher/dashboard", request.url));
    }

    // Redirect root to appropriate dashboard
    if (pathname === "/") {
      return NextResponse.redirect(
        new URL(
          role === "teacher" ? "/teacher/dashboard" : "/student/map",
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
