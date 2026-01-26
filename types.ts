
export interface ImageStep {
  id: string;
  type: 'cover' | 'first' | 'middle' | 'last';
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

export type AspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
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

export interface SavedProject {
  id: string;
  name: string;
  savedAt: number;
  // Book Generator data
  bookInput?: any;
  bookOutputs?: any;
  selectedTitle?: string;
  // Image Room data
  steps: ImageStep[];
  assets: Array<{ id: string; url: string; label: string; timestamp: number }>;
  config: GlobalConfig;
  characterRef: string | null;
  rules: GlobalRule[];
  quickPasteText: string;
}
