import type { Metadata, Viewport } from "next";
import { unstable_noStore as noStore } from "next/cache";
import { Geist, Geist_Mono } from "next/font/google";
import { readSiteSeo, resolveSiteFavicon, siteOrigin } from "@/lib/siteSeo";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  noStore();
  const seo = await readSiteSeo();
  const favicon = await resolveSiteFavicon(seo);
  const origin = siteOrigin();
  const keywords = seo.keywords
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    metadataBase: new URL(origin),
    title: seo.title,
    description: seo.description,
    keywords,
    applicationName: seo.siteName,
    alternates: { canonical: `${origin}/chat` },
    robots: { index: true, follow: true },
    icons: favicon
      ? {
          icon: { url: favicon.href, type: favicon.type },
          shortcut: { url: favicon.href, type: favicon.type },
        }
      : undefined,
    openGraph: {
      type: "website",
      locale: "ru_RU",
      url: `${origin}/chat`,
      siteName: seo.siteName,
      title: seo.title,
      description: seo.description,
      images: seo.ogImageUrl ? [{ url: seo.ogImageUrl }] : undefined,
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
