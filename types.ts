
export interface ImageStep {
  id: string;
  type: 'cover' | 'title' | 'first' | 'middle' | 'last';
  prompt: string;
  bookTitle?: string;
  cast?: string;
  storyStyle?: string; // AI-suggested visual style for typography (e.g., "weathered pirate wood")
  showText?: boolean;
  generatedImageUrl?: string; // Main image or background for cover
  generatedTitleUrl?: string; // Separate title layer
  generatedCastUrl?: string;  // Separate cast layer
  status: 'idle' | 'generating' | 'completed' | 'error';
  error?: string;
  textSide: 'left' | 'right' | 'none';
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
  demographicExclusion: boolean; // "Remove Black People" feature
}

export interface GenerationContext {
  steps: ImageStep[];
  rules: GlobalRule[];
}

export interface RenderedAsset {
  id: string;
  url: string;
  label: string;
  timestamp: number;
  stepId?: string;
  stepType?: string;
  coverPart?: "background" | "title" | "cast";
  originalPrompt?: string;
  isPending?: boolean;
}

export interface SavedProject {
  id: string;
  name: string;
  savedAt: number;
  bookInput?: import("./services/bookTextService").BookInput;
  bookOutputs?: import("./services/bookTextService").BookOutputs;
  selectedTitle?: string;
  steps: ImageStep[];
  assets: RenderedAsset[];
  config: GlobalConfig;
  characterRef: string | null;
  rules: GlobalRule[];
  quickPasteText: string;
}
