// Use localhost:5000 for local dev, or relative path for production/netlify
const getApiBaseUrl = () => {
  if (typeof window !== "undefined" && (import.meta as any).env.DEV) {
    return "http://localhost:5000";
  }
  return "/.netlify/functions";
};

export type Gender = "boy" | "girl" | "neutral";

export interface BookInput {
  name: string;
  age: string;
  gender: Gender;
  interests: string[];
  theme: string;
  lesson: string;

  /**
   * Optional: you can store a short descriptor like "use reference photo outfit"
   * or an id/url if you later want to pass it to the image model prompt.
   * Not required for text generation, but helpful for wiring.
   */
  // referenceImageUrl?: string;
}

export interface BookOutputs {
  storyLt?: string;
  titlesLt?: string;
  visualStyleTokenEn?: string;
  characterAnchorEn?: string;
  spreadPromptsEn?: string;
  coverPromptEn?: string;
  titleLogoPromptEn?: string;
}

function cleanText(s: string) {
  return (s || "").replace(/[*#_>`]/g, "").trim();
}

const VISUAL_STYLE_TOKENS = [
  "futuristic",
  "magical",
  "cozy",
  "adventurous",
  "pirate",
  "fantasy",
  "nature",
  "city",
  "bedtime",
  "playful",
  "educational",
] as const;

type VisualStyleToken = (typeof VISUAL_STYLE_TOKENS)[number];

const TITLE_STYLE_MAP: Record<VisualStyleToken, string> = {
  futuristic: `
STYLE: playful sci-fi, glossy plastic or holographic acrylic letters, soft neon edge glow, rounded shapes
DETAILS: subtle UI-like light strips and micro-lines (minimal), clean tech accents, friendly and modern
`,
  magical: `
STYLE: storybook magic, soft glowing paint or crystal-like letters, sparkles and fairy dust
DETAILS: gentle light trails, dreamy gradients, warm enchanted glow (NOT dark)
`,
  cozy: `
STYLE: warm illustrated letters, painted 3D or paper-cut craft feel, soft shadows
DETAILS: rounded friendly shapes, pastel tones, comforting vibe
`,
  adventurous: `
STYLE: bold animated letters, colorful enamel/painted 3D, dynamic tilt (fun action energy)
DETAILS: bright highlights, lively motion feel, playful not intense
`,
  pirate: `
STYLE: playful cartoon adventure, painted wood letters (bright, clean), rope accents
DETAILS: sunny warm tones, fun swashbuckling mood (NOT scary), no metal
`,
  fantasy: `
STYLE: classic animated fantasy, luminous crystal or soft magical stone (light and friendly)
DETAILS: gentle aura, sparkles, warm glow (NO runes, NO dark epic mood)
`,
  nature: `
STYLE: bright nature storybook, painted 3D letters with leaf/flower accents
DETAILS: soft sunlight glow, friendly organic shapes, clean and cheerful
`,
  city: `
STYLE: modern playful city vibe, glossy painted letters, subtle geometric accents
DETAILS: clean lines, bright pop colors, friendly and contemporary
`,
  bedtime: `
STYLE: dreamy bedtime letters, cloud-like plush texture or soft glowing fabric
DETAILS: calm moonlight glow, gentle stars/bokeh, soothing palette
`,
  playful: `
STYLE: chunky toy-like letters, foam/plastic texture, candy-bright colors
DETAILS: fun shine, rounded shapes, high readability
`,
  educational: `
STYLE: clean friendly learning vibe, bright plastic letters, minimal icons (book, star, shapes)
DETAILS: tidy, simple, readable, cheerful
`,
};

function normalizeToken(raw: string): VisualStyleToken {
  const t = (raw || "").toLowerCase().trim();
  const hit = VISUAL_STYLE_TOKENS.find((x) => x === t);
  return hit || "playful";
}

export class BookTextService {
  constructor(apiKey?: string) {
    // API key is no longer needed - handled server-side via Netlify Functions
    // Keeping parameter for backward compatibility but ignoring it
  }

  private async run(prompt: string): Promise<string> {
    const url = `${getApiBaseUrl()}/generate-text`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes("Failed to fetch") || msg.includes("ERR_CONNECTION_REFUSED") || msg.includes("Load failed")) {
        throw new Error(
          "Cannot reach the API. Run: npm run dev:netlify — then open http://localhost:8888 (do not use port 3000)."
        );
      }
      throw e;
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return cleanText(data.text || "");
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
        return title.replace(/^["'"']|["'"']$/g, "").trim();
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
    const prompt = `You are a professional children's book author.

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
...
Spread 14 (TEXT): ...`;

    return await this.run(prompt);
  }

  async generateTitlesLt(input: BookInput, storyLt: string): Promise<string> {
    const prompt = `You are a creative book editor for Lithuanian children's literature.

Generate 5 distinct book titles based on this story:

${storyLt}

CATEGORIES: CLASSIC, ACTION, MAGICAL, LESSON, SHORT & PUNCHY

RULES:
- All titles in LITHUANIAN
- Proper grammar
- High-end animated movie tone
- Titles must fit the story's world and mood (no medieval vibes unless story implies it)

OUTPUT FORMAT (STRICT):
1. [Category]: [Title]
2. [Category]: [Title]
3. [Category]: [Title]
4. [Category]: [Title]
5. [Category]: [Title]`;

    return await this.run(prompt);
  }

  async generateVisualStyleTokenEn(storyLt: string, theme: string): Promise<string> {
    const prompt = `You are a children's animation art director.

Goal: classify the story's VISUAL WORLD with ONE token.

STORY (Lithuanian):
${storyLt}

THEME INPUT:
${theme}

Pick ONE token from this list ONLY:
${VISUAL_STYLE_TOKENS.map((t) => `- ${t}`).join("\n")}

Rules:
- Choose the closest match to the story world and mood
- Do NOT invent new tokens

Return ONLY the token.`;

    return await this.run(prompt);
  }

  async generateTitleLogoPromptEn(
    storyTitle: string,
    theme: string,
    storyLt?: string,
    visualStyleTokenEn?: string
  ): Promise<string> {
    const title = cleanText(storyTitle);

    let token: VisualStyleToken = "playful";
    if (visualStyleTokenEn) {
      token = normalizeToken(visualStyleTokenEn);
    } else if (storyLt) {
      const derived = await this.generateVisualStyleTokenEn(storyLt, theme);
      token = normalizeToken(derived);
    }

    const styleBlock = TITLE_STYLE_MAP[token];

    const prompt = `Design a 3D title logo for a CHILDREN'S BOOK titled: "${title}"

VISUAL WORLD TOKEN: ${token}
THEME (hint only): ${theme}

${styleBlock}

GENERAL RULES:
- Kid-friendly, animated movie quality
- Thick, readable, rounded typography
- Bright, optimistic mood
- High readability at thumbnail size
- No harsh spikes, no gothic letterforms

BACKGROUND:
- Transparent OR pure white only
- Logo centered with generous padding and safe margins

LIGHTING:
- Soft studio lighting, gentle bloom, clean reflections (toy-like)

NEGATIVE (STRICT):
no metal, no steel, no bronze, no rust
no stone carving, no runes, no medieval fantasy unless token implies it
no steampunk gears
no gritty textures
no horror mood
no weapons

Return ONLY the final prompt string.`;

    return await this.run(prompt);
  }

  /**
   * UPDATED: Character Anchor must NOT invent clothing.
   * We explicitly force: "use outfit from reference photo" and forbid describing outfit/colors.
   */
  async generateCharacterAnchorEn(input: BookInput): Promise<string> {
    const prompt = `Create a CHARACTER ANCHOR for a children's book character that will be generated from a REFERENCE PHOTO of the child.

Age: ${input.age}
Gender: ${input.gender}
Interests: ${input.interests.join(", ")}
Theme: ${input.theme}

STRICT RULES:
- Do NOT describe clothing, outfit, shoes, accessories, or colors (the reference photo defines them)
- Do NOT describe hair/eye/skin color
- Do NOT mention ethnicity
- Keep identity consistent with the reference photo across all images
- You MAY describe only: age-appropriate vibe, expression range, proportions, and animation style

Write as an instruction line that tells the image model:
"Use the child's exact appearance and outfit from the reference photo."

FORMAT: One line only.
Return ONLY the anchor line.`;

    return await this.run(prompt);
  }

  /**
   * UPDATED: Spread prompts must reinforce the "reference photo outfit" rule and avoid outfit details.
   */
  async generateSpreadPromptsEn(
    storyLt: string,
    characterAnchor: string,
    visualStyleTokenEn?: string
  ): Promise<string> {
    const token = visualStyleTokenEn ? normalizeToken(visualStyleTokenEn) : "playful";

    const prompt = `Convert the story into 14 visual prompts for illustrations.

STORY (Lithuanian):
${storyLt}

CHARACTER ANCHOR (must be obeyed):
${characterAnchor}

VISUAL WORLD TOKEN:
${token}

ART STYLE (base):
3D animated movie quality, Pixar-like, clean render, soft volumetric lighting

GLOBAL CHARACTER RULES (STRICT):
- Use the child's exact face, hair, body proportions AND outfit from the REFERENCE PHOTO
- Do NOT describe clothing or colors in prompts (the photo defines them)

COMPOSITION RULES:
- Character NEVER centered: place on LEFT-THIRD or RIGHT-THIRD only
- GUTTER SAFETY: middle 20% must be background only (no faces, no text, no important objects)
- Keep mood kid-friendly, not scary

OUTPUT FORMAT (STRICT):
Spread 1 (PROMPT): [Character], [Position], [Action], [Environment], [Mood], [Art Style]
...
Spread 14 (PROMPT): ...`;

    return await this.run(prompt);
  }

  /**
   * UPDATED: Cover prompt must also enforce reference-photo outfit and forbid outfit descriptions.
   */
  async generateCoverPromptEn(
    storyLt: string,
    name: string,
    theme: string,
    storyTitle: string,
    characterAnchor: string,
    visualStyleTokenEn?: string
  ): Promise<string> {
    const token = visualStyleTokenEn ? normalizeToken(visualStyleTokenEn) : "playful";

    const prompt = `Create a FRONT COVER illustration prompt for a children's book.

STORY (Lithuanian):
${storyLt}

TITLE: ${storyTitle}
Character name: ${name}
THEME INPUT: ${theme}
VISUAL WORLD TOKEN: ${token}

CHARACTER ANCHOR (must be obeyed):
${characterAnchor}

GLOBAL CHARACTER RULES (STRICT):
- Use the child's exact face, hair, proportions AND outfit from the REFERENCE PHOTO
- Do NOT describe clothing or colors (the photo defines them)

GOAL:
- Capture the emotional heart + iconic moment(s) of the story
- Child-friendly, optimistic, high-end animated movie look

COMPOSITION:
- Character lower-middle (not blocking title area)
- Top 30% clean and simple for title placement
- Clear focal point, no clutter, strong silhouette

RENDER:
Pixar-like 3D, soft magical lighting (appropriate to token), clean, vibrant, cinematic framing

NEGATIVE:
no dark medieval mood unless token implies it
no metal/runes/steampunk gears
no horror

Return ONLY the final prompt string.`;

    return await this.run(prompt);
  }
}
