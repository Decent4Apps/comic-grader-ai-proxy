// app/layout.tsx
import "./globals.css"
import { Analytics } from "@vercel/analytics/react"

export const metadata = {
  title: "Comic Grader AI Proxy",
  description: "Server-side proxy for the Comic Grader AI app",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
