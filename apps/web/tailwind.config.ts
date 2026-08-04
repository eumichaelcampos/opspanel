import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        warm: "#EAC0A7",
        cool: "#C6C8CB",
        ink: "#162237",
        muted: "#6C7280",
        accent: "#C96D3A",
        dark: "#171717",
        success: "#287A5A",
        warning: "#A77422",
        danger: "#B54848",
      },
      borderRadius: {
        shell: "20px",
        card: "14px",
      },
      boxShadow: {
        glass: "0 8px 32px rgba(22, 34, 55, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
