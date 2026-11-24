import type { ReactNode } from "react";
import "./globals.css";

/**
 * Pass-through root layout. The locale layout renders <html lang> and <body>
 * so each exported page carries the right language. The `/` redirect and the
 * global 404 bring their own document shell.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
