import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          200: "#bae6fd",
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
          800: "#075985",
          900: "#0c4a6e",
        },
      },
      boxShadow: {
        "brand-glow": "0 0 0 4px rgba(14, 165, 233, 0.12)",
        "brand-glow-sm": "0 0 0 3px rgba(14, 165, 233, 0.10)",
        "brand-ring": "0 4px 16px rgba(14, 165, 233, 0.18)",
        "soft": "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)",
        "soft-md": "0 2px 4px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.06)",
        "soft-lg": "0 4px 8px rgba(15, 23, 42, 0.04), 0 12px 32px rgba(15, 23, 42, 0.08)",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)",
      },
      keyframes: {
        "ai-pulse": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.85", transform: "scale(1.05)" },
        },
      },
      animation: {
        "ai-pulse": "ai-pulse 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
