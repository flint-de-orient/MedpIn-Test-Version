import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "./providers";
import { THEME_BOOTSTRAP } from "@/lib/theme";
import "./globals.css";

/**
 * IBM Plex, because the clinic app and every prescription PDF are already set
 * in it. An operator moving between the two should not feel handed to a
 * different vendor — and Plex reads as an instrument rather than a brand,
 * which is what this is.
 *
 * Mono is not a decorative choice here. Practice ids, registration numbers,
 * patient counts and timestamps are most of what is on screen, and numbers
 * that do not line up in a column are decoration.
 */
const sans = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MedPin — operator console",
  description:
    "Create practices and decide whether they may operate. Holds no patient records.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} antialiased`}
      // Dark is opt-in from the toggle, which writes `class="dark"` here.
      // suppressHydrationWarning because that script runs before React does —
      // otherwise the first paint is the wrong theme and it flashes.
      suppressHydrationWarning
    >
      <head>
        {/* Before React, so the first paint is already the right colour. The
            one inline script in the app; the deploy hashes it into the CSP
            rather than allowing inline scripts generally. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="bg-background text-foreground flex min-h-dvh flex-col">
        <Providers>{children}</Providers>
        <Toaster position="bottom-center" />
      </body>
    </html>
  );
}
