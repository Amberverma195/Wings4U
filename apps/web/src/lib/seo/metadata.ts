import type { Metadata } from "next";
import { DEFAULT_DESCRIPTION, DEFAULT_OG_IMAGE_PATH, getSiteUrl, SITE_NAME } from "./site";

type PageMetadataInput = {
  /** Short page title; root layout template appends the site name. */
  title: string;
  description: string;
  path?: string;
  noIndex?: boolean;
  ogImage?: string;
};

function resolveAbsoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${getSiteUrl()}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

/** Site-wide defaults merged into the root layout (no page-specific canonical URL). */
export function createSiteDefaults(): Metadata {
  const defaultImageUrl = resolveAbsoluteUrl(DEFAULT_OG_IMAGE_PATH);

  return {
    metadataBase: new URL(getSiteUrl()),
    title: {
      default: SITE_NAME,
      template: `%s | ${SITE_NAME}`,
    },
    description: DEFAULT_DESCRIPTION,
    icons: {
      icon: "/logo.png",
      shortcut: "/logo.png",
      apple: "/logo.png",
    },
    openGraph: {
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
      images: [
        {
          url: defaultImageUrl,
          width: 1200,
          height: 630,
          alt: SITE_NAME,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      images: [defaultImageUrl],
    },
  };
}

export function createPageMetadata({
  title,
  description,
  path = "/",
  noIndex = false,
  ogImage = DEFAULT_OG_IMAGE_PATH,
}: PageMetadataInput): Metadata {
  const canonicalUrl = resolveAbsoluteUrl(path);
  const imageUrl = resolveAbsoluteUrl(ogImage);

  return {
    title,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    robots: noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: `${title} — ${SITE_NAME}`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}
