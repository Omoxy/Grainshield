import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#F0F5F0",
          100: "#DCE8DC",
          200: "#B8D1B8",
          300: "#8FB98F",
          400: "#6BA06B",
          500: "#4A7C4A",
          600: "#3D6B3D",
          700: "#2F5A2F",
          800: "#244824",
          900: "#1A361A",
          950: "#0F200F",
        },
        ink: {
          DEFAULT: "#1A1D1F",
          secondary: "#4B5058",
          tertiary: "#6F7681",
          muted: "#9AA1AD",
          faint: "#C5CAD1",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          raised: "#FAFBFC",
          secondary: "#F3F4F1",
          sunken: "#EDEEF0",
        },
        border: {
          DEFAULT: "#E3E5E8",
          subtle: "#EDEEF0",
          strong: "#C5CAD1",
        },
        risk: {
          critical: "#C53030",
          high: "#C05621",
          medium: "#B7791F",
          low: "#2B6CB0",
          safe: "#276749",
        },
        status: {
          success: "#276749",
          "success-surface": "#F0FFF4",
          warning: "#975A16",
          "warning-surface": "#FEFCE8",
          danger: "#9B2C2C",
          "danger-surface": "#FFF5F5",
          info: "#2B6CB0",
          "info-surface": "#EBF8FF",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-plex)",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "sans-serif",
        ],
        mono: [
          "'SF Mono'",
          "'Cascadia Code'",
          "'Fira Code'",
          "monospace",
        ],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
        xs: ["0.75rem", { lineHeight: "1.125rem" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.875rem", { lineHeight: "1.375rem" }],
        lg: ["1rem", { lineHeight: "1.5rem" }],
        xl: ["1.0625rem", { lineHeight: "1.5rem" }],
        "2xl": ["1.1875rem", { lineHeight: "1.625rem" }],
        "3xl": ["1.375rem", { lineHeight: "1.75rem" }],
      },
      spacing: {
        "4.5": "1.125rem",
        "13": "3.25rem",
      },
      boxShadow: {
        "card": "none",
        "card-hover": "0 1px 3px 0 rgba(0,0,0,0.04)",
        "elevated": "0 2px 8px -2px rgba(0,0,0,0.06)",
        "modal": "0 8px 24px -4px rgba(0,0,0,0.12)",
      },
      keyframes: {
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
      },
      animation: {
        "pulse-subtle": "pulse-subtle 3s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
