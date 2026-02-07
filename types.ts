// src/types.ts

export interface ImageStep {
  id: string;
  type: "cover" | "title" | "first" | "middle" | "last";
  prompt: string;

  // Optional metadata used in prompts / UI
  bookTitle?: string;
  cast?: string;
  storyStyle?: string;
  showText?: boolean;

  // Generated outputs
  generatedImageUrl?: string; // Main image or cover background
  generatedTitleUrl?: string; // (legacy / optional) title layer
  generatedCastUrl?: string;  // (legacy / optional) cast layer

  // State
  status: "idle" | "generating" | "completed" | "error";
  error?: string;

  // Layout hint for final composition
  textSide: "left" | "right" | "center" | "none";
}

export interface GlobalRule {
  id: string;
  text: string;
}

export type AspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9" | "21:9";
export type ImageSize = "1K" | "2K" | "4K";

export interface GlobalConfig {
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  bleedPercent: number; // 0 to 20

  /**
   * When true, the prompt layer adds your "demographicExclusion" constraint.
   * (UI label can be whatever; keep this neutral in types.)
   */
  demographicExclusion: boolean;
}

export interface GenerationContext {
  steps: ImageStep[];
  rules: GlobalRule[];
}

/** Asset item for gallery + export stack (supports pending placeholders). */
export interface RenderedAsset {
  id: string;
  url: string; // can be data: URL or remote URL
  label: string;
  timestamp: number;

  stepId?: string;
  stepType?: string;
  coverPart?: "background" | "title" | "cast";

  // For regeneration / traceability
  originalPrompt?: string;

  // If true: placeholder/spinner card while job is running
  isPending?: boolean;
}

/** Saved session payload stored in localStorage. */
export interface SavedProject {
  id: string;
  name: string;
  savedAt: number;

  // Book Generator snapshot (optional)
  bookInput?: import("./services/bookTextService").BookInput;
  bookOutputs?: import("./services/bookTextService").BookOutputs;
  selectedTitle?: string;

  // Image Room snapshot
  steps: ImageStep[];
  assets: RenderedAsset[];
  config: GlobalConfig;
  characterRef: string | null;
  rules: GlobalRule[];
  quickPasteText: string;
  animalRefs?: Record<string, string>;

  // Layout Room snapshot (optional; for backward compatibility)
  layoutSpreads?: SpreadComposeItem[];
}

/** Which main screen is active. */
export type Room = "book" | "image" | "layout";

/**
 * JSON returned by /.netlify/functions/generate-typography
 * Used to render cinematic text overlays.
 */
export type TypographySpec = {
  side: "left" | "right";
  overlay: { type: "gradient"; strength: number }; // 0..1
  blocks: Array<
    | {
        kind: "headline";
        text: string;
        uppercase?: boolean;
        size: number; // px
        color: string; // hex
        weight: 800;
        letterSpacing: number; // px
      }
    | {
        kind: "body";
        text: string;
        size: number; // px
        color: string; // hex
        weight: 500;
        lineHeight: number; // multiplier
      }
    | {
        kind: "emphasis";
        text: string;
        uppercase?: boolean;
        size: number; // px
        color: string; // hex
        weight: 900;
      }
  >;
};

/**
 * One printable spread in Layout Room:
 * - text comes from storyLt (Spread N (TEXT))
 * - image is selected from assets (linked by stepId/spreadNumber)
 * - composedDataUrl is the final merged PNG (data: URL)
 */
export type SpreadComposeItem = {
  id: string;
  spreadNumber: number; // 1..N
  text: string;

  stepId?: string;
  imageAssetId?: string;

  textSide: "left" | "right" | "none";
  textAlign?: "left" | "center" | "right";
  textScale?: number;
  textOffset?: { x: number; y: number };
  lineGap?: number; // multiplier for line spacing (default 1, range 0.8-1.5)
  typography?: TypographySpec;

  composedDataUrl?: string;
};
