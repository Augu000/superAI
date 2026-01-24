import { GoogleGenAI } from "@google/genai";

const TEXT_MODEL = "gemini-3-flash-preview";

export type Gender = "boy" | "girl" | "neutral";

export interface BookInput {
  name: string;
  age: string; // allow "6" or "5-7"
  gender: Gender;
  interests: string[]; // 1-3
  theme: string;
  lesson: string;
}

export interface BookOutputs {
  storyLt?: string;              // full 14 spreads text
  titlesLt?: string;             // 5 titles (raw text)
  characterAnchorEn?: string;    // anchor line
  spreadPromptsEn?: string;      // spread 1-14 prompts
  coverPromptEn?: string;        // front cover prompt
  titleLogoPromptEn?: string;    // 3D typography prompt
}

function cleanText(s: string) {
  return (s || "").replace(/[*#_>`]/g, "").trim();
}

export class BookTextService {
  private ai: GoogleGenAI;

  constructor(apiKey?: string) {
    // Your Vite config defines process.env.API_KEY from GEMINI_API_KEY
    const key = apiKey || (process.env.API_KEY as string) || (process.env.GEMINI_API_KEY as string);
    if (!key) {
      throw new Error("Missing GEMINI_API_KEY. Add it to .env.local as GEMINI_API_KEY=...");
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

  /**
   * Helper: parse the 5 titles output into an array of title strings.
   * Expected lines like: "1. [Category]: Title"
   */
  parseTitlesLt(titlesLt: string): string[] {
    if (!titlesLt) return [];

    return titlesLt
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\d+\./.test(l)) // lines starting with "1." etc
      .map((l) => {
        // Remove "1. " prefix
        const noNum = l.replace(/^\d+\.\s*/, "").trim();
        // If contains ":" then take part after the first colon (Category: Title)
        const colonIdx = noNum.indexOf(":");
        const title = (colonIdx >= 0 ? noNum.slice(colonIdx + 1) : noNum).trim();
        return title.replace(/^["']|["']$/g, "").trim();
      })
      .filter(Boolean);
  }

  /**
   * Helper: if user didn't pick a title, pick a safe default.
   */
  pickTitleFromTitlesLt(titlesLt: string, selectedTitle?: string): string {
    const cleanedSelected = cleanText(selectedTitle || "");
    if (cleanedSelected) return cleanedSelected;

    const titles = this.parseTitlesLt(titlesLt);
    return titles[0] || "Untitled";
  }

  async generateStoryLt(input: BookInput): Promise<string> {
    const prompt = `
You are a professional children’s book author.

TASK: Write a 14-spread story in LITHUANIAN.

TARGET AGE: ${input.age}
THEME: ${input.theme}
LESSON: ${input.lesson}
CHARACTER: ${input.name} (${input.gender})
INTERESTS: ${input.interests.join(", ")}

STORY STRUCTURE RULES:
- Spread 1-3: Introduction & The Wish (Introduction of the character and the problem)
- Spread 4-9: The Journey (Meeting obstacles, using interests to solve them)
- Spread 10-12: The Climax (The biggest challenge requiring bravery/lesson)
- Spread 13-14: Resolution (Safe return home, lesson learned)

WRITING RULES:
- Language: LITHUANIAN
- Each spread has 25-50 words max.
- Simple, warm, rhythmic prose (avoid complex rhymes, focus on flow).
- No scary elements.
- Do NOT describe visuals or page numbers.

OUTPUT FORMAT (STRICT):
Spread 1 (TEXT): ...
Spread 2 (TEXT): ...
...
Spread 14 (TEXT): ...
`;
    return await this.run(prompt);
  }

  async generateTitlesLt(input: BookInput, storyLt: string): Promise<string> {
    const prompt = `
You are a creative book editor specializing in Lithuanian children's literature.

Based on the story provided below, generate 5 distinct, catchy, and magical book titles in LITHUANIAN.

STORY DATA:
- Child Name: ${input.name}
- Theme: ${input.theme}
- Lesson: ${input.lesson}
- Story Text:
${storyLt}

TITLE CATEGORIES:
1. THE CLASSIC: A "Name and the [Object/Place]" style title.
2. THE ACTION: A title focusing on the journey or the mission.
3. THE MAGICAL: A poetic or whimsical title using descriptive adjectives.
4. THE LESSON: A title that subtly hints at the growth/bravery of the character.
5. THE SHORT & PUNCHY: A 1-2 word title that is memorable and bold.

RULES:
- All titles must be in LITHUANIAN.
- Ensure proper grammar (correct suffixes for the child's name).
- Titles should sound like high-end 3D animated movie titles.

OUTPUT FORMAT (STRICT):
1. [Category]: [Title Idea]
2. [Category]: [Title Idea]
3. [Category]: [Title Idea]
4. [Category]: [Title Idea]
5. [Category]: [Title Idea]
`;
    return await this.run(prompt);
  }

  async generateTitleLogoPromptEn(storyTitle: string, theme: string): Promise<string> {
    const title = cleanText(storyTitle);
    const prompt = `
You are a 3D graphic designer. Create a high-quality 3D typography logo for a children's book.

TEXT: "${title}"
STYLE:
- Chunky, bubble-style 3D letters (Pixar movie style).
- Glossy finish with a colorful gradient matching the theme: ${theme}.
- Playful, magical, and bold design.

TECHNICAL:
- ISOLATED on a solid, flat WHITE background.
- ONLY the text. No characters, no frames, no subtitles.
- Cinematic lighting, stylized 3D render.

OUTPUT: Return ONLY the final English prompt string.
`;
    return await this.run(prompt);
  }

  async generateCharacterAnchorEn(input: BookInput): Promise<string> {
  const prompt = `
You are an expert Art Director.

Create a reusable CHARACTER ANCHOR for a children's book main character.
This anchor will be combined with a REAL PHOTO reference later.

CRITICAL RULES:
- DO NOT mention hair color, eye color, skin tone, ethnicity, or facial measurements.
- DO NOT invent specific biometric features.
- Keep the character description compatible with any child appearance.
- You MAY describe: age, vibe, outfit, accessories related to interests, and art style.

Format (STRICT, one line):
"${input.age} year old child (${input.gender}), wearing [outfit based on interests], [one small prop related to interests], cute expressive face, Pixar style 3D character, consistent across all scenes"

Interests: ${input.interests.join(", ")}
Theme: ${input.theme}

OUTPUT: Return ONLY the anchor line.
`;
  return await this.run(prompt);
}

  async generateSpreadPromptsEn(storyLt: string, characterAnchor: string): Promise<string> {
    const artStyle =
      `3D animated movie still, Pixar style, Disney style, octane render, soft volumetric lighting,  stylized realism, cute rounded shapes, shallow depth of field`;

    const prompt = `
You are an expert Art Director for animated movies.

Your mission is to convert the story into visual prompts where the character is NEVER in the center, to avoid the book's spine/gutter.

STORY (Lithuanian):
${storyLt}

ART STYLE STRING:
"${artStyle}"

COMPOSITION RULES (STRICT):
1. NO CENTERED CHARACTERS: The main character must be positioned in the LEFT-THIRD or RIGHT-THIRD of the frame.
2. GUTTER SAFETY: The middle 20% of the image must be background only (no faces, no important objects).
3. PADDING: Leave significant empty space (background) at the very top, bottom, and side edges to account for print bleed.
4. ASYMMETRIC DESIGN: Use a cinematic "rule of thirds" layout for every scene.

OUTPUT FORMAT (STRICT):
Spread 1 (PROMPT): ${characterAnchor}, [Position: Right-Third or Left-Third of frame], [Action], [Environment], [Mood], ${artStyle}
...
Spread 14 (PROMPT): ${characterAnchor}, [Position: Right-Third or Left-Third of frame], [Action], [Environment], [Mood], ${artStyle}

IMPORTANT:
- Prompts must be in ENGLISH.
- Do not add extra commentary.
`;
    return await this.run(prompt);
  }

  async generateCoverPromptEn(
    storyLt: string,
    name: string,
    theme: string,
    storyTitle: string,
    characterAnchor: string
  ): Promise<string> {
    const prompt = `
You are a children’s book editor and visual director.

Create a FRONT COVER image prompt that summarizes the emotional heart of the story below.

INPUT DATA:
- Full Story Text:
${storyLt}
- Character: ${name}
- Theme: ${theme}
- Story Title: ${storyTitle}
- Character Anchor: ${characterAnchor}

INSTRUCTIONS:
1. ANALYZE: Identify the most magical or iconic environment/moment from the 14 spreads.
2. COMPOSE: Focus on [Character Anchor]. Position them in the lower-middle of the frame.
3. LAYOUT SAFETY: Ensure the top 30% is clean (sky/simple background) for the title.
4. CONSISTENCY: Use visual elements mentioned in the story.

PROMPT CONSTRUCTION (ENGLISH):
"Front book cover illustration. [Character Anchor] in a [Describe iconic scene/moment from the story]. The character is looking [adventurous/happy/curious] towards the viewer. BACKGROUND: [Specific environment], Pixar-style 3D, magical cinematic lighting with soft god rays. COMPOSITION: Hero centered in lower-third, ample negative space at the top for typography. TECHNICAL: Disney style, octane render, vivid colors, stylized realism"

OUTPUT FORMAT (STRICT):
Return ONLY the final English prompt string.
`;
    return await this.run(prompt);
  }
}
