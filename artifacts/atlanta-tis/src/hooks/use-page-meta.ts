/**
 * Set per-page <title> + meta description.
 *
 * We're an SPA, so the bundled index.html ships a single generic title
 * and Google's crawler runs JS — which means a useEffect-driven update
 * is enough for both rendered tab text and indexable metadata. No
 * react-helmet dependency.
 *
 * On unmount we restore the previous values so navigating Home → /cities
 * → Home rolls back cleanly without leaving a stale per-metro title.
 */

import { useEffect } from "react";

const SITE_SUFFIX = " · Simple Impact Studies";

export function usePageMeta(opts: { title: string; description?: string; canonical?: string }) {
  const { title, description, canonical } = opts;
  useEffect(() => {
    const prevTitle = document.title;
    const descEl = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const ogTitleEl = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
    const ogDescEl = document.querySelector<HTMLMetaElement>('meta[property="og:description"]');
    const canonicalEl = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');

    const prevDesc = descEl?.content ?? "";
    const prevOgTitle = ogTitleEl?.content ?? "";
    const prevOgDesc = ogDescEl?.content ?? "";
    const prevCanonical = canonicalEl?.href ?? "";

    const fullTitle = title.endsWith(SITE_SUFFIX) ? title : title + SITE_SUFFIX;
    document.title = fullTitle;
    if (ogTitleEl) ogTitleEl.content = fullTitle;
    if (description) {
      if (descEl) descEl.content = description;
      if (ogDescEl) ogDescEl.content = description;
    }
    if (canonical) {
      if (canonicalEl) {
        canonicalEl.href = canonical;
      } else {
        const link = document.createElement("link");
        link.rel = "canonical";
        link.href = canonical;
        document.head.appendChild(link);
      }
    }

    return () => {
      document.title = prevTitle;
      if (descEl) descEl.content = prevDesc;
      if (ogTitleEl) ogTitleEl.content = prevOgTitle;
      if (ogDescEl) ogDescEl.content = prevOgDesc;
      if (canonical && canonicalEl) canonicalEl.href = prevCanonical;
    };
  }, [title, description, canonical]);
}
