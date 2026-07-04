import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import QueryProvider from "@/components/providers/QueryProvider";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

const SITE_NAME = "Checklist Hub";
const SITE_URL = "https://checklisthub.in";
const SITE_DESCRIPTION =
  "Build evidence-based species checklists for any region or taxon. Import from GBIF, iNaturalist and eBird, validate taxonomy, collaborate with reviewers, and publish a Darwin Core Archive to an IPT — in minutes, not weeks.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Checklist Hub - Species Checklist Software for Biodiversity Experts",
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "species checklist software",
    "biodiversity checklist tool",
    "GBIF checklist",
    "Darwin Core Archive generator",
    "taxonomy validation",
    "IPT publishing",
    "iNaturalist data",
    "eBird checklist",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: "Checklist Hub - Species Checklist Software for Biodiversity Experts",
    description: SITE_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Checklist Hub - Species Checklist Software for Biodiversity Experts",
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: "siNCXP3nTWA3s8f2IdvJ_yw3jngRTrZF74ve_VqDR74",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/res/landing/checklist_hub_logo.png`,
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      name: SITE_NAME,
      applicationCategory: "ScienceApplication",
      operatingSystem: "Web",
      description: SITE_DESCRIPTION,
      url: SITE_URL,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} ${jetbrainsMono.variable}`}>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className="bg-surface text-on-surface min-h-screen selection:bg-primary-container selection:text-white overflow-x-hidden font-body-sm"
        suppressHydrationWarning
      >
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
