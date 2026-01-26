import { GoogleGenAI } from "@google/genai";

const TEXT_MODEL = "gemini-3-flash-preview";

export type Gender = "boy" | "girl" | "neutral";

export interface BookInput {
  name: string;
  age: string;
  gender: Gender;
  interests: string[];
  theme: string;
  lesson: string;
}

export interface BookOutputs {
  storyLt?: string;
  titlesLt?: string;
  characterAnchorEn?: string;
  spreadPromptsEn?: string;
  coverPromptEn?: string;
  titleLogoPromptEn?: string;
}

function cleanText(s: string) {
  return (s || "").replace(/[*#_>`]/g, "").trim();
}

export class BookTextService {
  private ai: GoogleGenAI;

  constructor(apiKey?: string) {
    const key = apiKey || (import.meta.env.VITE_API_KEY as string);
    if (!key) {
      throw new Error("Missing VITE_API_KEY in .env file");
    }
    this.ai = new GoogleGenAI({ apiKey: key });
  }

  private async run(prompt: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
    });
    return cleanText(response.text);
  }

  parseTitlesLt(titlesLt: string): string[] {
    if (!titlesLt) return [];
    return titlesLt
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\d+\./.test(l))
      .map((l) => {
        const noNum = l.replace(/^\d+\.\s*/, "").trim();
        const colonIdx = noNum.indexOf(":");
        const title = (colonIdx >= 0 ? noNum.slice(colonIdx + 1) : noNum).trim();
        return title.replace(/^["'"'"']|["'"'"']$/g, "").trim();
      })
      .filter(Boolean);
  }

  pickTitleFromTitlesLt(titlesLt: string, selectedTitle?: string): string {
    const cleanedSelected = cleanText(selectedTitle || "");
    if (cleanedSelected) return cleanedSelected;
    const titles = this.parseTitlesLt(titlesLt);
    return titles[0] || "Untitled";
  }

  async generateStoryLt(input: BookInput): Promise<string> {
    const prompt = `You are a professional children'"'"'s book author.
TASK: Write a 14-spread story in LITHUANIAN.
TARGET AGE: ${input.age}
THEME: ${input.theme}
LESSON: ${input.lesson}
CHARACTER: ${input.name} (${input.gender})
INTERESTS: ${input.interests.join(", ")}
STORY STRUCTURE RULES:
- Spread 1-3: Introduction & The Wish
- Spread 4-9: The Journey
- Spread 10-12: The Climax
- Spread 13-14: Resolution
WRITING RULES:
- Language: LITHUANIAN
- Each spread has 25-50 words max.
- Simple, warm, rhythmic prose
- No scary elements
- Do NOT describe visuals
OUTPUT FORMAT (STRICT):
Spread 1 (TEXT): ...
Spread 14 (TEXT): ...`;
    return await this.run(prompt);
  }

  async generateTitlesLt(input: BookInput, storyLt: string): Promise<string> {
    const prompt = `You are a creative book editor for Lithuanian children'"'"'s literature.
Generate 5 distinct book titles based on this story:
${storyLt}
CATEGORIES: CLASSIC, ACTION, MAGICAL, LESSON, SHORT & PUNCHY
Rules: All in LITHUANIAN, proper grammar, high-end animated movie style
OUTPUT FORMAT (STRICT):
1. [Category]: [Title]
2. [Category]: [Title]
3. [Category]: [Title]
4. [Category]: [Title]
5. [Category]: [Title]`;
    return await this.run(prompt);
  }

  async generateTitleLogoPromptEn(storyTitle: string, theme: string): Promise<string> {
    const title = cleanText(storyTitle);
    const prompt = `Design a 3D typography logo for children'"'"'s book: "${title}"
STYLE: Chunky bubble 3D letters (Pixar style), glossy gradient matching: ${theme}
TECHNICAL: WHITE background only, cinematic lighting, octane render
Return ONLY the final prompt string.`;
    return await this.run(prompt);
  }

  async generateCharacterAnchorEn(input: BookInput): Promise<string> {
    const prompt = `Create a CHARACTER ANCHOR for a children'"'"'s book character.
Age: ${input.age}, Gender: ${input.gender}, Interests: ${input.interests.join(", ")}, Theme: ${input.theme}
RULES: NO hair/eye/skin color, NO ethnicity, compatible with any child appearance
Describe: age, vibe, outfit, accessories, art style
FORMAT: One line only
Return ONLY the anchor line.`;
    return await this.run(prompt);
  }

  async generateSpreadPromptsEn(storyLt: string, characterAnchor: string): Promise<string> {
    const prompt = `Convert story to 14 visual prompts. Character NEVER centered - LEFT/RIGHT-THIRD only.
STORY: ${storyLt}
CHARACTER ANCHOR: ${characterAnchor}
ART STYLE: 3D animated movie, Pixar style, octane render, volumetric lighting
GUTTER SAFETY: Middle 20% background only
OUTPUT FORMAT:
Spread 1 (PROMPT): [Character], [Position], [Action], [Environment], [Mood], [Art Style]
...
Spread 14 (PROMPT): ...`;
    return await this.run(prompt);
  }

  async generateCoverPromptEn(storyLt: string, name: string, theme: string, storyTitle: string, characterAnchor: string): Promise<string> {
    const prompt = `Create a FRONT COVER prompt. Summarize the emotional heart of this story:
${storyLt}
Character: ${name}, Theme: ${theme}, Title: ${storyTitle}
CHARACTER ANCHOR: ${characterAnchor}
Analyze iconic moments. Position character lower-middle. Top 30% clean for title.
TECHNICAL: Disney style, octane render, Pixar-style 3D, magical lighting
Return ONLY the final prompt string.`;
    return await this.run(prompt);
  }
}
