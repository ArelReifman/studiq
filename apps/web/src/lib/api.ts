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

// ─── Learning Resources (formula sheets, summaries, …) ──────────────────────
// All access flows through the API — the table is server-only (Template B,
// see docs/SUPABASE_DATA_API_GRANTS.md). Uploads use the sign+confirm flow
// to bypass Vercel's 4.5 MB body limit.

import type { LearningResource, LearningResourceVisibility } from "@studiq/types";

export interface UploadResourceMeta {
  course_id: string;
  topic_id?: string | null;
  title: string;
  description?: string | null;
  visibility?: LearningResourceVisibility;
}

export const learningResourcesApi = {
  listForTeacher(courseId: string, topicId?: string) {
    const qs = new URLSearchParams({ course_id: courseId });
    if (topicId) qs.set("topic_id", topicId);
    return api.get<LearningResource[]>(`/learning-resources?${qs}`);
  },
  listForStudent(courseId: string, topicId?: string) {
    const qs = new URLSearchParams({ course_id: courseId });
    if (topicId) qs.set("topic_id", topicId);
    return api.get<LearningResource[]>(`/learning-resources/student?${qs}`);
  },
  async upload(file: File, meta: UploadResourceMeta): Promise<LearningResource> {
    // 1. Ask backend for a signed upload URL + reserved resource id.
    const signed = await api.post<{
      signedUrl: string;
      token: string;
      path: string;
      resource_id: string;
    }>("/learning-resources/sign", {
      file_name: file.name,
      content_type: file.type || "application/octet-stream",
      size: file.size,
      course_id: meta.course_id,
      topic_id: meta.topic_id ?? null,
    });

    // 2. PUT the file straight to Supabase Storage — bypasses Vercel.
    const { error } = await supabase.storage
      .from("uploads")
      .uploadToSignedUrl(signed.path, signed.token, file, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      });
    if (error) throw new Error(`Upload failed: ${error.message}`);

    // 3. Confirm with the API — inserts the DB row using the reserved id.
    return api.post<LearningResource>("/learning-resources/confirm", {
      resource_id: signed.resource_id,
      path: signed.path,
      file_name: file.name,
      file_type: file.type || "application/octet-stream",
      file_size_bytes: file.size,
      course_id: meta.course_id,
      topic_id: meta.topic_id ?? null,
      title: meta.title,
      description: meta.description ?? null,
      visibility: meta.visibility ?? "teacher_only",
    });
  },
  patch(
    id: string,
    body: {
      title?: string;
      description?: string | null;
      visibility?: LearningResourceVisibility;
    }
  ) {
    return api.patch<LearningResource>(`/learning-resources/${id}`, body);
  },
  delete(id: string) {
    return api.delete<{ message: string }>(`/learning-resources/${id}`);
  },
};
