import { describe, it, expect } from "vitest";
import { z } from "zod";

// Replicate the schemas used in auth routes for testing
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1),
  role: z.enum(["teacher", "student"]),
  teacher_invite_token: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

describe("Registration validation", () => {
  it("accepts valid teacher registration", () => {
    const result = registerSchema.safeParse({
      email: "teacher@school.com",
      password: "securepass",
      full_name: "John Doe",
      role: "teacher",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid student registration with invite token", () => {
    const result = registerSchema.safeParse({
      email: "student@school.com",
      password: "securepass",
      full_name: "Jane Doe",
      role: "student",
      teacher_invite_token: "abc123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = registerSchema.safeParse({
      email: "not-an-email",
      password: "securepass",
      full_name: "John",
      role: "teacher",
    });
    expect(result.success).toBe(false);
  });

  it("rejects password shorter than 8 characters", () => {
    const result = registerSchema.safeParse({
      email: "a@b.com",
      password: "short",
      full_name: "John",
      role: "teacher",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty full_name", () => {
    const result = registerSchema.safeParse({
      email: "a@b.com",
      password: "securepass",
      full_name: "",
      role: "teacher",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid role", () => {
    const result = registerSchema.safeParse({
      email: "a@b.com",
      password: "securepass",
      full_name: "John",
      role: "admin",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const result = registerSchema.safeParse({
      email: "a@b.com",
    });
    expect(result.success).toBe(false);
  });
});

describe("Login validation", () => {
  it("accepts valid login", () => {
    const result = loginSchema.safeParse({
      email: "a@b.com",
      password: "mypassword",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = loginSchema.safeParse({
      email: "invalid",
      password: "mypassword",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing password", () => {
    const result = loginSchema.safeParse({
      email: "a@b.com",
    });
    expect(result.success).toBe(false);
  });
});
