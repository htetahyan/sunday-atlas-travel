import type { MetadataRoute } from "next";
import { isIndexable } from "@/config/site";
import { siteOrigin } from "@/lib/metadata";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  if (!isIndexable) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    };
  }

  const origin = siteOrigin();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin/", "/*/cms-export/", "/*?package=*"],
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
