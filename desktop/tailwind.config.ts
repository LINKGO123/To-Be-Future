import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          50: "hsl(var(--primary-50))",
          100: "hsl(var(--primary-100))",
          200: "hsl(var(--primary-200))",
          300: "hsl(var(--primary-300))",
          400: "hsl(var(--primary-400))",
          500: "hsl(var(--primary-500))",
          600: "hsl(var(--primary-600))",
          700: "hsl(var(--primary-700))",
          800: "hsl(var(--primary-800))",
          900: "hsl(var(--primary-900))",
          950: "hsl(var(--primary-950))",
          subtle: "hsl(var(--primary-subtle))",
          "subtle-strong": "hsl(var(--primary-subtle-strong))",
          "subtle-active": "hsl(var(--primary-subtle-active))",
        },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        success: "hsl(var(--success))",
        danger: "hsl(var(--danger))",
        warning: "hsl(var(--warning))",
        info: "hsl(var(--info))",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "PingFang SC", "Microsoft YaHei", "sans-serif"],
        mono: ["SFMono-Regular", "Consolas", "ui-monospace", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "6px",
        sm: "4px",
        card: "var(--fr-radius-card)",
        btn: "var(--fr-radius-btn)",
        input: "var(--fr-radius-input)",
      },
      boxShadow: {
        glass: "0 8px 28px rgba(0,0,0,.07), inset 0 1px 0 rgba(255,255,255,.035)",
        glow: "0 0 0 1px hsl(var(--primary) / .25)",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
} satisfies Config;
