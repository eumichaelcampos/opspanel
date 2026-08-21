import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        warm: "rgb(var(--warm) / <alpha-value>)",
        cool: "rgb(var(--cool) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        dark: "rgb(var(--dark) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
      },
      borderRadius: {
        shell: "20px",
        card: "14px",
      },
      boxShadow: {
        glass: "var(--glass-shadow)",
        "glow-accent": "0 0 32px rgb(var(--accent) / 0.25)",
        "glow-danger": "0 0 28px rgb(var(--danger) / 0.28)",
      },
    },
  },
  plugins: [],
};

export default config;
