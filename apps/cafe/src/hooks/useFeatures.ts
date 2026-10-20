"use client";

import { features, type Features } from "@cafemenu/shared";
import { useMemo } from "react";

import { useCafeSettings } from "@/hooks/useCafeSettings";

/**
 * What the cafe's plan includes (`features` in @cafemenu/shared), live with its
 * settings. Every plan-dependent screen asks here rather than assuming, so a
 * paid plan later is a row in PLAN_FEATURES, not a hunt through the app.
 */
export function useFeatures(): Features {
  const { plan } = useCafeSettings().settings;
  return useMemo(() => features({ plan }), [plan]);
}
