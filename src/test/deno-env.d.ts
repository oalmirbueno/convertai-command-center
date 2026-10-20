declare const Deno: {
  readonly env: {
    get(name: string): string | undefined;
  };
};

// Vitest executes the pure Edge helpers in Node. Resolve their Deno package
// specifiers to the same real types used by the application, rather than any.
declare module "npm:@supabase/supabase-js@2" {
  export * from "@supabase/supabase-js";
}
declare module "https://esm.sh/@supabase/supabase-js@2.45.4" {
  export * from "@supabase/supabase-js";
}
declare module "https://esm.sh/zod@3.23.8" {
  export * from "zod";
}
