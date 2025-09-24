// app/layout.tsx
import type { ReactNode } from "react";

export const metadata = {
  title: "Comic Grader AI Proxy",
  description: "Proxy for mobile apps → AI providers",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
