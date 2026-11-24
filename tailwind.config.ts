import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: "#FAF7F2",
        ink: "#1C2430",
        muted: "#3E4C5A",
        teal: {
          DEFAULT: "#0F6E6E",
          dark: "#0B5555",
          soft: "#E5F2F2",
        },
        sand: {
          DEFAULT: "#C8794A",
          deep: "#8A4E2C",
          soft: "#F8EBE3",
        },
        danger: "#8E2F2F",
        line: "#E4DCD0",
        card: "#FFFCF8",
      },
      fontFamily: {
        serif: [
          "var(--font-serif)",
          "Palatino Linotype",
          "Palatino",
          "Hiragino Mincho ProN",
          "Yu Mincho",
          "serif",
        ],
        sans: [
          "var(--font-sans)",
          "Hiragino Sans",
          "Hiragino Kaku Gothic ProN",
          "Yu Gothic",
          "Noto Sans JP",
          "Meiryo",
          "sans-serif",
        ],
      },
      maxWidth: {
        page: "1200px",
      },
      boxShadow: {
        card: "0 16px 40px -24px rgba(28, 36, 48, 0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
