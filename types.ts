export interface ImageStep {
  id: string;
  type: 'cover' | 'first' | 'middle' | 'last';
  prompt: string;
  bookTitle?: string;
  cast?: string;
  showText?: boolean; // New property to toggle text overlays on cover
  generatedImageUrl?: string;
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
  demographicExclusion: boolean; // "black away" feature
}

export interface GenerationContext {
  steps: ImageStep[];
  rules: GlobalRule[];
}