// The Android phones and tablets scripts/check-android.ts looks with (CSS pixels and pixel density,
// as Chrome on each reports them)
export const ANDROID_DEVICES = {
  s23: { name: "Galaxy S23", w: 360, h: 780, dpr: 3, tablet: false },
  pixel7: { name: "Pixel 7", w: 412, h: 915, dpr: 2.625, tablet: false },
  a54: { name: "Galaxy A54", w: 384, h: 854, dpr: 2.8125, tablet: false },
  small: { name: "Small phone", w: 360, h: 640, dpr: 2, tablet: false },
  land: { name: "Phone sideways", w: 780, h: 360, dpr: 3, tablet: false },
  "tab-p": { name: "Galaxy Tab S9 upright", w: 800, h: 1280, dpr: 2, tablet: true },
  "tab-l": { name: "Galaxy Tab S9 / Pixel Tablet sideways", w: 1280, h: 800, dpr: 2, tablet: true },
  "tab-a": { name: "Galaxy Tab A upright", w: 600, h: 960, dpr: 1.5, tablet: true },
} as const;
