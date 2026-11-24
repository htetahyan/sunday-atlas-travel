import { localizedString, localizedStringArray } from "./localizedString";
import { destination } from "./destination";
import { travelPackage } from "./travelPackage";
import { blogPost } from "./blogPost";
import { staticPage } from "./staticPage";
import { siteSettings } from "./siteSettings";
import { subscriber } from "./subscriber";
import { packageSupplier } from "./packageSupplier";

export const schemaTypes = [
  localizedString,
  localizedStringArray,
  destination,
  travelPackage,
  blogPost,
  staticPage,
  siteSettings,
  subscriber,
  packageSupplier,
];

export {
  localizedString,
  localizedStringArray,
  destination,
  travelPackage,
  blogPost,
  staticPage,
  siteSettings,
  subscriber,
  packageSupplier,
};
