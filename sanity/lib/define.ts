/**
 * Lightweight Sanity v3 schema & studio configuration helpers.
 * Compatible with `sanity` v3 `defineType`, `defineField`, `defineConfig`, and `defineCliConfig`
 * without requiring the full Studio bundle during static Next.js builds.
 */

export type SanityRule = {
  required: () => SanityRule;
  min: (min: number) => SanityRule;
  max: (max: number) => SanityRule;
  positive: () => SanityRule;
  integer: () => SanityRule;
};

export interface SanityFieldDefinition {
  name: string;
  title?: string;
  type: string;
  description?: string;
  group?: string | string[];
  fieldset?: string;
  initialValue?: unknown;
  options?: Record<string, unknown>;
  of?: Array<{ type: string; fields?: SanityFieldDefinition[]; name?: string; title?: string }>;
  fields?: SanityFieldDefinition[];
  validation?: (rule: SanityRule) => SanityRule;
}

export interface SanityTypeDefinition {
  name: string;
  title: string;
  type: "document" | "object";
  description?: string;
  groups?: Array<{ name: string; title: string; default?: boolean }>;
  fieldsets?: Array<{ name: string; title: string; options?: Record<string, unknown> }>;
  fields: SanityFieldDefinition[];
  preview?: {
    select?: Record<string, string>;
    prepare?: (selection: Record<string, unknown>) => {
      title?: string;
      subtitle?: string;
    };
  };
}

export interface SanityStudioConfig {
  name: string;
  title: string;
  projectId: string;
  dataset: string;
  basePath?: string;
  schema: {
    types: SanityTypeDefinition[];
  };
}

export interface SanityCliConfig {
  api: {
    projectId: string;
    dataset: string;
  };
  studioHost?: string;
}

export function defineField(field: SanityFieldDefinition): SanityFieldDefinition {
  return field;
}

export function defineType(typeDef: SanityTypeDefinition): SanityTypeDefinition {
  return typeDef;
}

export function defineConfig(config: SanityStudioConfig): SanityStudioConfig {
  return config;
}

export function defineCliConfig(config: SanityCliConfig): SanityCliConfig {
  return config;
}
