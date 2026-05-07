import { supabase } from "@/lib/supabase";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "/api";

/**
 * Try to parse an HTTP error response into a human-readable message.
 * - JSON bodies: use `.error` or `.message` field
 * - Non-JSON bodies (HTML error pages, plain text): include status + snippet
 */
async function parseErrorResponse(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const body = (await res.json()) as {
        error?: string | { issues?: Array<{ message?: string }> };
        message?: string;
      };
      const err = body.error;
      if (typeof err === "string") return err;
      if (err && typeof err === "object" && Array.isArray(err.issues)) {
        return err.issues.map((i) => i.message).filter(Boolean).join(", ") ||
          `HTTP ${res.status}`;
      }
      return body.message ?? `HTTP ${res.status}`;
    }
    const text = await res.text();
    const snippet = text.slice(0, 120).replace(/\s+/g, " ").trim();
    return snippet
      ? `HTTP ${res.status}: ${snippet}`
      : `HTTP ${res.status} ${res.statusText}`;
  } catch {
    return `HTTP ${res.status} ${res.statusText}`;
  }
}

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });
    } catch {
      throw new Error(
        `Cannot reach the API (${API_URL}). Start the backend (e.g. pnpm dev from the repo root) and set DATABASE_URL so the API can start.`
      );
    }

    if (!res.ok) {
      // If token expired, force re-login so the user doesn't get silent failures.
      // Skip auth endpoints — a 401 there means "wrong credentials", not "session expired".
      const isAuthEndpoint = path.startsWith("/auth/");
      if (res.status === 401 && !isAuthEndpoint && typeof window !== "undefined") {
        const { useAuthStore } = await import("@/store/auth");
        useAuthStore.getState().clearAuth();
        window.location.href = "/login";
        throw new Error("Session expired — redirecting to login");
      }
      throw new Error(await parseErrorResponse(res));
    }

    return res.json() as Promise<T>;
  }

  get<T>(path: string) {
    return this.request<T>(path);
  }

  post<T>(path: string, body: unknown) {
    return this.request<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  patch<T>(path: string, body: unknown) {
    return this.request<T>(path, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  put<T>(path: string, body: unknown) {
    return this.request<T>(path, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: "DELETE" });
  }

  /**
   * Direct-to-Supabase upload. Bypasses Vercel's 4.5MB body size limit by
   * uploading the file straight to Supabase Storage using a signed URL.
   *
   * Flow:
   *   1. POST to `signPath` → { signedUrl, token, path }
   *   2. PUT file to Supabase Storage via the signed URL
   *   3. POST to `confirmPath` with { file_name, path } → DB record updated
   */
  async uploadDirect<T>(
    signPath: string,
    confirmPath: string,
    file: File
  ): Promise<T> {
    // 1. Ask our API for a signed upload URL
    const signed = await this.post<{
      signedUrl: string;
      token: string;
      path: string;
    }>(signPath, {
      file_name: file.name,
      content_type: file.type || "application/octet-stream",
      size: file.size,
    });

    // 2. Upload directly to Supabase Storage — does NOT go through Vercel
    const { error: uploadError } = await supabase.storage
      .from("uploads")
      .uploadToSignedUrl(signed.path, signed.token, file, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    // 3. Confirm with our API — updates the DB row with the public URL
    return this.post<T>(confirmPath, {
      file_name: file.name,
      path: signed.path,
    });
  }

  /** @deprecated Use uploadDirect — plain multipart uploads hit Vercel's 4.5MB body limit. */
  async upload<T>(path: string, file: File): Promise<T> {
    const headers: Record<string, string> = {
      "X-Requested-With": "XMLHttpRequest",
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers,
      body: formData,
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error(await parseErrorResponse(res));
    }

    return res.json() as Promise<T>;
  }
}

export const api = new ApiClient();
