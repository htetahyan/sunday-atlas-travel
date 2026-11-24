import { defineCliConfig } from "./sanity/lib/define";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "mi09tcmc";
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";

export default defineCliConfig({
  api: {
    projectId,
    dataset,
  },
  studioHost: "sunday-atlas-travel",
});
