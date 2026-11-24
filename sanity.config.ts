import { defineConfig } from "./sanity/lib/define";
import { schemaTypes } from "./sanity/schemas";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "mi09tcmc";
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";

export default defineConfig({
  name: "sunday-atlas-travel-studio",
  title: "Sunday Atlas Travel CMS",
  projectId,
  dataset,
  basePath: "/studio",
  schema: {
    types: schemaTypes,
  },
});
