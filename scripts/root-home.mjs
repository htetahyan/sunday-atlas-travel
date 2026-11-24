// Serve the English home page at "/" (200) instead of a 301 to /en/.
// Google reads the site name only from the domain's home page, so "/" must carry the
// WebSite structured data. The copy keeps canonical -> /en/ and the hreflang set.
import { copyFileSync, existsSync } from "node:fs";
const src = "out/en/index.html";
if (!existsSync(src)) { console.error("root-home: out/en/index.html missing"); process.exit(1); }
copyFileSync(src, "out/index.html");
console.log("✓ [root-home] out/index.html = English home (WebSite schema at /).");
