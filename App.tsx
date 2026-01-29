// src/App.tsx
import React, { useState, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import type { ImageStep, GlobalRule, AspectRatio, GlobalConfig, ImageSize, SavedProject, RenderedAsset } from "./types";
import { GeminiService } from "./services/geminiService";
import type { BookInput, BookOutputs } from "./services/bookTextService";

import StepInput from "./components/StepInput";
import RuleInput from "./components/RuleInput";
import BookGenerator from "./components/BookGenerator";


const App: React.FC = () => {
  const createInitialSteps = (): ImageStep[] => {
    const steps: ImageStep[] = [];
    steps.push({
      id: uuidv4(),
      type: "cover",
      prompt: "",
      status: "idle",
      textSide: "none",
      bookTitle: "",
      cast: "",
      showText: true,
    });
    steps.push({
      id: uuidv4(),
      type: "title",
      prompt: "",
      status: "idle",
      textSide: "none",
      bookTitle: "",
      cast: "",
    });
    steps.push({
      id: uuidv4(),
      type: "first",
      prompt: "",
      status: "idle",
      textSide: "left", // Default text side for first spread
    });
    steps.push({
      id: uuidv4(),
      type: "last",
      prompt: "",
      status: "idle",
      textSide: "none",
      bookTitle: "",
      cast: "",
    });
    return steps;
  };

  const [steps, setSteps] = useState<ImageStep[]>(createInitialSteps());
  const [rules, setRules] = useState<GlobalRule[]>([]);
  const [characterRef, setCharacterRef] = useState<string | null>(null);

  const [config, setConfig] = useState<GlobalConfig>({
    aspectRatio: "21:9",
    imageSize: "4K",
    bleedPercent: 15,
    demographicExclusion: true,
  });

  const getOutputDimensions = (): { width: number; height: number } => {
    const sizeMap: Record<ImageSize, number> = { "1K": 1024, "2K": 2048, "4K": 4096 };
    const size = sizeMap[config.imageSize];
    const [w, h] = config.aspectRatio.split(":").map(Number);
    if (w === h) return { width: size, height: size };
    const landscape = w > h;
    const long = size;
    const short = Math.round((landscape ? h / w : w / h) * size);
    return landscape ? { width: long, height: short } : { width: short, height: long };
  };

  const [isProcessActive, setIsProcessActive] = useState(false);
  const isProcessActiveRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [currentQueueIndex, setCurrentQueueIndex] = useState(-1);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [isSuggestingTitle, setIsSuggestingTitle] = useState(false);
  // const [isGeneratingTitleCast, setIsGeneratingTitleCast] = useState(false); // Removed - cover overlays deprecated

  const [quickPasteText, setQuickPasteText] = useState("");
  const [showQuickPaste, setShowQuickPaste] = useState(false);

  const [generationPhase, setGenerationPhase] = useState<
    "idle" | "background" | "title" | "cast" | "scene"
  >("idle");

  const [assets, setAssets] = useState<RenderedAsset[]>([]);
  const [activeRoom, setActiveRoom] = useState<"book" | "image">("book");
  const [showSavedProjects, setShowSavedProjects] = useState(false);
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [bookGeneratorKey, setBookGeneratorKey] = useState(0);
  const [showAssetGallery, setShowAssetGallery] = useState(false);
  const [isGalleryMinimized, setIsGalleryMinimized] = useState(false);
  const [regeneratingAssetId, setRegeneratingAssetId] = useState<string | null>(null);
  const [regenerateEditPrompt, setRegenerateEditPrompt] = useState("");
  const [selectedAssetForPreview, setSelectedAssetForPreview] = useState<string | null>(null);

  const getGemini = () => new GeminiService();

  const handleCharacterUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setCharacterRef(reader.result as string);
    reader.readAsDataURL(file);
  };

  const updateStep = (id: string, updates: Partial<ImageStep>) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));

  const deleteStep = (id: string) => setSteps((prev) => prev.filter((s) => s.id !== id));

  const addAsset = (url: string, label: string, stepId?: string, stepType?: string, coverPart?: "background" | "title" | "cast", originalPrompt?: string) => {
    setAssets((prev) => [{ id: uuidv4(), url, label, timestamp: Date.now(), stepId, stepType, coverPart, originalPrompt, isPending: false }, ...prev]);
  };

  const addPendingAsset = (label: string, stepId?: string, stepType?: string, coverPart?: "background" | "title" | "cast") => {
    const pendingId = uuidv4();
    setAssets((prev) => [{ id: pendingId, url: "", label, timestamp: Date.now(), stepId, stepType, coverPart, isPending: true }, ...prev]);
    return pendingId;
  };

  const replacePendingAsset = (pendingId: string, url: string, originalPrompt?: string) => {
    setAssets((prev) => prev.map((a) =>
      a.id === pendingId
        ? { ...a, url, isPending: false, originalPrompt, timestamp: Date.now() }
        : a
    ));
  };

  const removePendingAsset = (pendingId: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== pendingId));
  };

  const handleRetryStuckAsset = (asset: RenderedAsset) => {
    if (!asset.isPending) return;
    removePendingAsset(asset.id);
  };

  /** Spread number 1..N for first/middle/last steps; null for cover/title */
  const getSpreadNumber = (step: ImageStep, stepList: ImageStep[]): number | null => {
    if (step.type !== "first" && step.type !== "middle" && step.type !== "last") return null;
    const spreadSteps = stepList.filter((s) => s.type === "first" || s.type === "middle" || s.type === "last");
    const idx = spreadSteps.findIndex((s) => s.id === step.id);
    return idx >= 0 ? idx + 1 : null;
  };

  const addSpread = () => {
    setSteps((prev) => {
      const newSteps = [...prev];
      const lastIdx = newSteps.findIndex((s) => s.type === "last");
      newSteps.splice(lastIdx, 0, {
        id: uuidv4(),
        type: "middle",
        prompt: "",
        status: "idle",
        textSide: "none",
      });
      return newSteps;
    });
  };

  // Accept blocks like:
  // COVER: ...
  // Spread 1 (SCENE): ...
  // Spread 1 (PROMPT): ...   <-- also supported
  const handleQuickPaste = () => {
    if (!quickPasteText.trim()) return;

    const spreadBlocks = quickPasteText
      .split(/(?=Spread \d+)|(?=COVER\b)/i)
      .filter((b) => b.trim());

    const middlePrompts: string[] = [];
    let coverPrompt = "";

    spreadBlocks.forEach((block) => {
      const trimmed = block.trim();
      const lower = trimmed.toLowerCase();

      if (lower.startsWith("spread")) {
        // remove either (SCENE) or (PROMPT) headers
        const clean = trimmed
          .replace(/Spread \d+\s*\((SCENE|PROMPT)\)\s*:/gi, "")
          .trim();
        if (clean) middlePrompts.push(clean);
      } else if (lower.startsWith("cover")) {
        const clean = trimmed.replace(/COVER\s*:?/gi, "").trim();
        if (clean) coverPrompt = clean;
      }
    });

    setSteps((prev) => {
      const cover = prev.find((s) => s.type === "cover")!;
      const first = prev.find((s) => s.type === "first")!;
      const last = prev.find((s) => s.type === "last")!;

      const middleSteps: ImageStep[] = middlePrompts.map((prompt) => ({
        id: uuidv4(),
        type: "middle",
        prompt,
        status: "idle",
        textSide: "none",
      }));

      return [
        { ...cover, prompt: coverPrompt || cover.prompt },
        { ...first, prompt: "Cinematic Logo" },
        ...middleSteps,
        { ...last, prompt: "Closing Card" },
      ];
    });

    setQuickPasteText("");
    setShowQuickPaste(false);
  };

  // Load saved projects from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("savedProjects");
      if (saved) {
        setSavedProjects(JSON.parse(saved));
      }
    } catch (e) {
      console.error("Error loading saved projects:", e);
    }
  }, []);

  // Save projects to localStorage whenever savedProjects changes
  useEffect(() => {
    try {
      localStorage.setItem("savedProjects", JSON.stringify(savedProjects));
    } catch (e) {
      console.error("Error saving projects:", e);
    }
  }, [savedProjects]);

  const saveCurrentProject = () => {
    const projectName = prompt("Enter a name for this project:");
    if (!projectName || !projectName.trim()) return;

    // Get BookGenerator data from localStorage
    const bookInput = localStorage.getItem("bookGenerator_input");
    const bookOutputs = localStorage.getItem("bookGenerator_outputs");
    const selectedTitle = localStorage.getItem("bookGenerator_selectedTitle");

    const project: SavedProject = {
      id: uuidv4(),
      name: projectName.trim(),
      savedAt: Date.now(),
      bookInput: bookInput ? JSON.parse(bookInput) : undefined,
      bookOutputs: bookOutputs ? JSON.parse(bookOutputs) : undefined,
      selectedTitle: selectedTitle || undefined,
      steps: [...steps],
      assets: [...assets],
      config: { ...config },
      characterRef,
      rules: [...rules],
      quickPasteText,
    };

    setSavedProjects((prev) => [project, ...prev]);
    setShowSavedProjects(false);
  };

  const loadProject = (project: SavedProject) => {
    if (!confirm(`Load "${project.name}"? This will replace your current work.`)) return;

    // Load BookGenerator data
    if (project.bookInput) {
      localStorage.setItem("bookGenerator_input", JSON.stringify(project.bookInput));
    }
    if (project.bookOutputs) {
      localStorage.setItem("bookGenerator_outputs", JSON.stringify(project.bookOutputs));
    }
    if (project.selectedTitle) {
      localStorage.setItem("bookGenerator_selectedTitle", project.selectedTitle);
    }

    // Load Image Room data
    setSteps(project.steps.map((s: ImageStep) => ({ ...s })));
    setAssets(project.assets.map((a: RenderedAsset) => ({ ...a })));
    setConfig({ ...project.config });
    setCharacterRef(project.characterRef);
    setRules(project.rules.map((r: GlobalRule) => ({ ...r })));
    setQuickPasteText(project.quickPasteText);

    setShowSavedProjects(false);
    // Force BookGenerator to reload by changing its key
    setBookGeneratorKey((prev) => prev + 1);
  };

  const deleteProject = (projectId: string) => {
    if (!confirm("Delete this saved project?")) return;
    setSavedProjects((prev) => prev.filter((p) => p.id !== projectId));
  };

  // Enhanced function to intelligently transfer all BookGenerator text to Image Room
  const transferAllTextToImageRoom = (
    outputs: BookOutputs,
    input: BookInput,
    selectedTitle: string
  ) => {
    // Find existing steps
    const coverStep = steps.find((s) => s.type === "cover");
    const titleStep = steps.find((s) => s.type === "title");
    const firstStep = steps.find((s) => s.type === "first");
    const lastStep = steps.find((s) => s.type === "last");
    const middleSteps = steps.filter((s) => s.type === "middle");

    // Update cover step with cover prompt, title, and character name
    if (coverStep) {
      updateStep(coverStep.id, {
        prompt: outputs.coverPromptEn || coverStep.prompt,
        bookTitle: selectedTitle || coverStep.bookTitle,
        cast: input.name || coverStep.cast,
        showText: true,
      });
    }

    // Update Title card with 3D Logo Prompt from Book Generator
    if (titleStep) {
      updateStep(titleStep.id, {
        prompt: outputs.titleLogoPromptEn || titleStep.prompt,
        bookTitle: selectedTitle || titleStep.bookTitle,
      });
    }

    // Parse Spread Prompts (EN): detect all spreads and create one image-generation card per spread in the story timeline.
    // Last spread (Spread N) gets the actual last chunk content; no image generation for it.
    if (outputs.spreadPromptsEn) {
      const spreadChunks = outputs.spreadPromptsEn
        .split(/\n(?=Spread\s+\d+\s*\((?:PROMPT|SCENE)\)\s*:?\s*)/gi)
        .map((s) => s.trim())
        .filter(Boolean);

      const cleanPrompt = (chunk: string) =>
        chunk.replace(/Spread\s+\d+\s*\((?:PROMPT|SCENE)\)\s*:?\s*/gi, "").trim();

      const N = spreadChunks.length;
      const spread1Prompt = N > 0 ? cleanPrompt(spreadChunks[0]) : "";
      const middleChunks = N > 2 ? spreadChunks.slice(1, -1) : [];
      const lastChunkPrompt = N > 1 ? cleanPrompt(spreadChunks[N - 1]) : "";

      setSteps((prevSteps) => {
        const cover = prevSteps.find((s) => s.type === "cover")!;
        const title = prevSteps.find((s) => s.type === "title");

        const firstUpdated: ImageStep = {
          id: uuidv4(),
          type: "first",
          prompt: spread1Prompt,
          status: "idle",
          textSide: "left",
        };

        const newMiddleSteps: ImageStep[] = middleChunks.map((chunk) => ({
          id: uuidv4(),
          type: "middle" as const,
          prompt: cleanPrompt(chunk) || "",
          status: "idle" as const,
          textSide: "none" as const,
        }));

        const spreadSteps: ImageStep[] =
          N >= 2
            ? [
                firstUpdated,
                ...newMiddleSteps,
                {
                  id: uuidv4(),
                  type: "last" as const,
                  prompt: lastChunkPrompt,
                  status: "idle" as const,
                  textSide: "none" as const,
                  bookTitle: "",
                  cast: "",
                },
              ]
            : [firstUpdated];

        if (!title) {
          return [cover, ...spreadSteps];
        }
        const titleUpdated = {
          ...title,
          prompt: outputs.titleLogoPromptEn || title.prompt,
          bookTitle: selectedTitle || title.bookTitle,
        };
        return [cover, titleUpdated, ...spreadSteps];
      });
    }

    // Also populate quick paste for backward compatibility
    const blocks: string[] = [];
    if (outputs.coverPromptEn) {
      blocks.push(`COVER: ${outputs.coverPromptEn}`);
    }
    if (outputs.spreadPromptsEn) {
      const spreadChunks = outputs.spreadPromptsEn
        .split(/\n(?=Spread\s+\d+\s+\(PROMPT\)\s*:)/gi)
        .map((s) => s.trim())
        .filter(Boolean);
      spreadChunks.forEach((chunk) => {
        blocks.push(chunk.replace(/\(PROMPT\)/gi, "(SCENE)"));
      });
    }
    if (blocks.length > 0) {
      setQuickPasteText(blocks.join("\n\n"));
    }
  };

  // BookGenerator → auto-fill QuickPaste → open the panel (legacy function, kept for compatibility)
  const ingestPromptsToTimeline = (
    scenePrompts: string,
    coverPrompt: string,
    storyTitle?: string,
    heroName?: string
  ) => {
    const blocks: string[] = [];
    blocks.push(`COVER: ${coverPrompt}`);

    // break on each "Spread N (PROMPT):" or "Spread N (SCENE):"
    const spreadChunks = scenePrompts
      .split(/\n(?=Spread\s+\d+\s*\((?:PROMPT|SCENE)\)\s*:?\s*)/gi)
      .map((s) => s.trim())
      .filter(Boolean);

    // convert PROMPT -> SCENE to match your style (either works now)
    spreadChunks.forEach((chunk) => {
      blocks.push(chunk.replace(/\(PROMPT\)/gi, "(SCENE)"));
    });

    setQuickPasteText(blocks.join("\n\n"));
    setShowQuickPaste(true);

    // Optionally sync cover metadata fields
    const cover = steps.find((s) => s.type === "cover");
    if (cover) {
      updateStep(cover.id, {
        bookTitle: storyTitle ?? cover.bookTitle,
        cast: heroName ?? cover.cast,
      });
    }
  };

  const executeCurrentStep = async (index: number) => {
    const step = steps[index];
    setSteps((prev) => prev.map((s, idx) => (idx === index ? { ...s, status: "generating" } : s)));

    let pendingId: string | null = null;

    try {
      const gemini = getGemini();
      const ruleTexts = rules.map((r) => r.text).filter((t) => t.trim().length > 0);
      const previousImage = index > 0 ? steps[index - 1].generatedImageUrl : undefined;

      if (step.type === "cover") {
        setGenerationPhase("background");
        pendingId = addPendingAsset("Cover Background (Seamless)", step.id, step.type, "background");
        const bgUrl = await gemini.generateStepImage(
          { ...step, coverPart: "background" } as any,
          ruleTexts,
          config,
          previousImage,
          characterRef || undefined
        );
        updateStep(step.id, { generatedImageUrl: bgUrl });
        replacePendingAsset(pendingId, bgUrl, step.prompt);
        setSteps((prev) => prev.map((s, idx) => (idx === index ? { ...s, status: "completed" } : s)));
      } else if (step.type === "title") {
        setGenerationPhase("title");
        pendingId = addPendingAsset("Book Title Page", step.id, step.type);
        const imageUrl = await gemini.generateStepImage(
          step,
          ruleTexts,
          config,
          previousImage,
          characterRef || undefined
        );
        updateStep(step.id, { generatedImageUrl: imageUrl });
        replacePendingAsset(pendingId, imageUrl, step.bookTitle || "Book Title");
        setSteps((prev) =>
          prev.map((s, idx) => (idx === index ? { ...s, status: "completed", generatedImageUrl: imageUrl } : s))
        );
      } else {
        setGenerationPhase("scene");
        const label =
          step.type === "last"
            ? "Ending Card"
            : step.type === "first"
              ? "Spread 1 Artwork"
              : `Spread ${index - 1} Artwork`;
        pendingId = addPendingAsset(label, step.id, step.type);
        const imageUrl = await gemini.generateStepImage(
          step,
          ruleTexts,
          config,
          previousImage,
          characterRef || undefined
        );
        setSteps((prev) =>
          prev.map((s, idx) => (idx === index ? { ...s, status: "completed", generatedImageUrl: imageUrl } : s))
        );
        replacePendingAsset(pendingId, imageUrl, step.prompt);
      }

      setGenerationPhase("idle");
      setAwaitingApproval(true);
    } catch (err: any) {
      setSteps((prev) => prev.map((s, idx) => (idx === index ? { ...s, status: "error", error: err.message } : s)));
      if (pendingId) removePendingAsset(pendingId);
      setIsProcessActive(false);
      isProcessActiveRef.current = false;
      setGenerationPhase("idle");
    }
  };

  // All spreads (including last / Spread N) are in the render queue and have generate buttons
  const activeQueueSteps = steps
    .map((s, i) =>
      s.prompt.trim() || s.type === "cover" || s.type === "title" ? i : -1
    )
    .filter((i) => i !== -1);

  const currentActiveStep = currentQueueIndex >= 0 ? steps[activeQueueSteps[currentQueueIndex]] : null;

  const startNarrativeFlow = async () => {
    const queue = activeQueueSteps;
    if (queue.length === 0) return;
    setIsProcessActive(true);
    isProcessActiveRef.current = true;
    setIsPaused(false);
    isPausedRef.current = false;
    setCurrentQueueIndex(0);
    setAwaitingApproval(false);
    
    // Generate all steps sequentially without approval
    for (let i = 0; i < queue.length; i++) {
      // Check if paused
      while (isPausedRef.current && isProcessActiveRef.current) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Check if process was stopped
      if (!isProcessActiveRef.current) break;
      
      setCurrentQueueIndex(i);
      await executeCurrentStep(queue[i]);
      
      // Check if paused after step
      while (isPausedRef.current && isProcessActiveRef.current) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (!isProcessActiveRef.current) break;
      
      // Move to next step (no Cover Title/Cast overlays; title typography lives on Book Title spread)
      if (i < queue.length - 1) {
        setCurrentQueueIndex(i + 1);
        setAwaitingApproval(false);
      }
    }
    
    setIsProcessActive(false);
    isProcessActiveRef.current = false;
    setIsPaused(false);
    setCurrentQueueIndex(-1);
    setAwaitingApproval(false);
    setGenerationPhase("idle");
  };

  const handlePause = () => {
    setIsPaused(true);
    isPausedRef.current = true;
  };

  const handleResume = () => {
    setIsPaused(false);
    isPausedRef.current = false;
  };

  const handleStop = () => {
    setIsProcessActive(false);
    isProcessActiveRef.current = false;
    setIsPaused(false);
    isPausedRef.current = false;
    setCurrentQueueIndex(-1);
    setAwaitingApproval(false);
    setGenerationPhase("idle");
  };

  const handleApproval = async () => {
    const queue = activeQueueSteps;
    const stepIndex = queue[currentQueueIndex];
    if (stepIndex === undefined) return;
    
    // Get fresh step state
    const currentStep = steps[stepIndex];
    if (!currentStep) return;

    // No Cover Title/Cast overlays; title typography lives on Book Title spread
    const nextQueueIdx = currentQueueIndex + 1;
    if (nextQueueIdx < queue.length) {
      setCurrentQueueIndex(nextQueueIdx);
      setAwaitingApproval(false);
      await executeCurrentStep(queue[nextQueueIdx]);
    } else {
      setIsProcessActive(false);
      isProcessActiveRef.current = false;
      setCurrentQueueIndex(-1);
      setAwaitingApproval(false);
    }
  };

  const handleGenerateTitle = async (id: string) => {
    if (isSuggestingTitle) return;
    
    const step = steps.find((s) => s.id === id);
    if (!step) return;
    
    // If title already exists, don't regenerate
    if (step.bookTitle && step.bookTitle.trim().length > 0) {
      return;
    }
    
    setIsSuggestingTitle(true);
    try {
      const gemini = getGemini();
      const allPrompts = steps.map((s) => s.prompt).filter((p) => p && p.trim().length > 0);
      const analysis = await gemini.analyzeStory(allPrompts);

      updateStep(id, { bookTitle: analysis.title, storyStyle: analysis.visualStyle });

      // Sync style across pages for consistency
      const titlePage = steps.find((s) => s.type === "title");
      if (titlePage) updateStep(titlePage.id, { bookTitle: analysis.title, storyStyle: analysis.visualStyle });

      const lastPage = steps.find((s) => s.type === "last");
      if (lastPage) updateStep(lastPage.id, { storyStyle: analysis.visualStyle });
    } finally {
      setIsSuggestingTitle(false);
    }
  };

  const handleGenerateSingleStep = async (stepId: string) => {
    const stepIndex = steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) return;
    
    const step = steps[stepIndex];
    if (!step || (!step.prompt.trim() && step.type !== "title")) return;
    
    // Update step status to generating
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, status: "generating" } : s)));
    
    try {
      const gemini = getGemini();
      const ruleTexts = rules.map((r) => r.text).filter((t) => t.trim().length > 0);
      const previousImage = stepIndex > 0 ? steps[stepIndex - 1].generatedImageUrl : undefined;

      if (step.type === "cover") {
        // Only generate background for cover
        setGenerationPhase("background");
        const pendingId = addPendingAsset("Cover Background (Seamless)", step.id, step.type, "background");
        const bgUrl = await gemini.generateStepImage(
          { ...step, coverPart: "background" } as any,
          ruleTexts,
          config,
          previousImage,
          characterRef || undefined
        );
        updateStep(step.id, { generatedImageUrl: bgUrl });
        replacePendingAsset(pendingId, bgUrl, step.prompt);
      } else if (step.type === "title") {
        // Generate book title page
        setGenerationPhase("title");
        const pendingId = addPendingAsset("Book Title Page", step.id, step.type);
        const imageUrl = await gemini.generateStepImage(
          step,
          ruleTexts,
          config,
          previousImage,
          characterRef || undefined
        );
        updateStep(step.id, { generatedImageUrl: imageUrl });
        replacePendingAsset(pendingId, imageUrl, step.bookTitle || "Book Title");
      } else {
        setGenerationPhase("scene");
        const label =
          step.type === "last"
            ? "Last Spread"
            : step.type === "first"
              ? "Spread 1 Artwork"
              : `Spread ${stepIndex - 1} Artwork`;
        const pendingId = addPendingAsset(label, step.id, step.type);
        const imageUrl = await gemini.generateStepImage(
          step,
          ruleTexts,
          config,
          previousImage,
          characterRef || undefined
        );
        updateStep(step.id, { generatedImageUrl: imageUrl });
        replacePendingAsset(pendingId, imageUrl, step.prompt);
      }
      
      setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, status: "completed" } : s)));
      setGenerationPhase("idle");
    } catch (err: any) {
      setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, status: "error", error: err.message } : s)));
      setGenerationPhase("idle");
    }
  };

  const downloadImage = async (url: string, label: string) => {
    const filename = `${label.replace(/\s+/g, "_")}_${Date.now()}.png`;
    if (url.startsWith("data:")) {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      return;
    }
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error("Fetch failed");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
    } catch {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.target = "_blank";
      link.rel = "noopener";
      link.click();
    }
  };

  const downloadAll = () => {
    assets.filter((a) => !a.isPending && a.url).forEach((asset, idx) => {
      setTimeout(() => downloadImage(asset.url, asset.label), idx * 300);
    });
  };

  const handleRegenerateAsset = async (asset: RenderedAsset) => {
    if (!asset.stepId || !regenerateEditPrompt.trim()) return;
    
    // Prevent multiple simultaneous regenerations - check if ANY asset is currently regenerating
    const isAnyRegenerating = assets.some((a) => a.isPending);
    if (isAnyRegenerating) {
      console.log("Another asset is already regenerating, please wait");
      return;
    }
    
    // Only proceed if this is the asset we're working on
    if (regeneratingAssetId !== asset.id) return;
    
    // Mark as regenerating to show spinner
    setRegeneratingAssetId(asset.id);
    
    try {
      const stepIndex = steps.findIndex((s) => s.id === asset.stepId);
      if (stepIndex === -1) {
        setRegeneratingAssetId(null);
        return;
      }
      
      // Now mark as pending to show spinner
      setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, isPending: true } : a));
      
      const step = steps[stepIndex];

      const gemini = getGemini();
      const ruleTexts = rules.map((r) => r.text).filter((t) => t.trim().length > 0);
      
      // Enhance the original prompt with user edits - keep original context + add edit request
      const enhancedPrompt = asset.originalPrompt 
        ? `${asset.originalPrompt}. EDIT REQUEST: ${regenerateEditPrompt.trim()}. Keep the same overall composition, characters, and scene - only apply the requested changes.`
        : regenerateEditPrompt.trim();

      // Convert current image to base64 for reference (maintains visual consistency)
      let referenceImageBase64: string | undefined;
      if (asset.url && asset.url.startsWith('data:')) {
        // Already base64
        referenceImageBase64 = asset.url;
      } else if (asset.url) {
        // Fetch and convert to base64
        try {
          const response = await fetch(asset.url);
          const blob = await response.blob();
          referenceImageBase64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          console.warn("Could not convert image to base64 for reference:", e);
        }
      }

      let newUrl: string;
      
      if (asset.coverPart) {
        // Regenerate cover part
        const stepWithEdit = { ...step };
        if (asset.coverPart === "title") {
          stepWithEdit.bookTitle = enhancedPrompt;
        } else if (asset.coverPart === "cast") {
          stepWithEdit.cast = enhancedPrompt;
        } else {
          stepWithEdit.prompt = enhancedPrompt;
        }
        
        newUrl = await gemini.generateStepImage(
          { ...stepWithEdit, coverPart: asset.coverPart } as any,
          ruleTexts,
          config,
          undefined, // previousImage
          characterRef || undefined,
          referenceImageBase64 // Pass reference image for consistency
        );
        
        // Update the step with new URL
        if (asset.coverPart === "background") {
          updateStep(step.id, { generatedImageUrl: newUrl });
        } else if (asset.coverPart === "title") {
          updateStep(step.id, { generatedTitleUrl: newUrl });
        } else if (asset.coverPart === "cast") {
          updateStep(step.id, { generatedCastUrl: newUrl });
        }
      } else {
        // Regenerate regular step
        newUrl = await gemini.generateStepImage(
          { ...step, prompt: enhancedPrompt },
          ruleTexts,
          config,
          undefined, // Don't use previousImage for continuity during regeneration
          characterRef || undefined,
          referenceImageBase64 // Pass reference image for consistency
        );
        
        updateStep(step.id, { generatedImageUrl: newUrl });
      }

      // Update asset with new image
      setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, url: newUrl, timestamp: Date.now(), originalPrompt: enhancedPrompt, isPending: false } : a));
      setRegenerateEditPrompt("");
      setRegeneratingAssetId(null);
    } catch (error) {
      console.error("Error regenerating asset:", error);
      // Reset pending state on error
      setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, isPending: false } : a));
      setRegeneratingAssetId(null);
      setRegenerateEditPrompt("");
    }
  };

  // Quick regenerate - uses original prompt and global rules only, no edits
  const handleQuickRegenerate = async (asset: RenderedAsset) => {
    if (!asset.stepId) return;
    
    // Prevent multiple simultaneous regenerations
    const isAnyRegenerating = assets.some((a) => a.isPending);
    if (isAnyRegenerating) {
      console.log("Another asset is already regenerating, please wait");
      return;
    }
    
    // Mark as pending to show spinner
    setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, isPending: true } : a));
    
    try {
      const stepIndex = steps.findIndex((s) => s.id === asset.stepId);
      if (stepIndex === -1) {
        setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, isPending: false } : a));
        return;
      }
      
      const step = steps[stepIndex];
      const gemini = getGemini();
      const ruleTexts = rules.map((r) => r.text).filter((t) => t.trim().length > 0);
      
      // Use the original prompt from the asset or step
      const originalPrompt = asset.originalPrompt || step.prompt;

      let newUrl: string;
      
      if (asset.coverPart) {
        // Regenerate cover part with original settings
        newUrl = await gemini.generateStepImage(
          { ...step, coverPart: asset.coverPart } as any,
          ruleTexts,
          config,
          undefined,
          characterRef || undefined
        );
        
        // Update the step with new URL
        if (asset.coverPart === "background") {
          updateStep(step.id, { generatedImageUrl: newUrl });
        } else if (asset.coverPart === "title") {
          updateStep(step.id, { generatedTitleUrl: newUrl });
        } else if (asset.coverPart === "cast") {
          updateStep(step.id, { generatedCastUrl: newUrl });
        }
      } else {
        // Regenerate regular step with original prompt
        const previousImage = stepIndex > 0 ? steps[stepIndex - 1]?.generatedImageUrl : undefined;
        
        newUrl = await gemini.generateStepImage(
          { ...step, prompt: originalPrompt },
          ruleTexts,
          config,
          previousImage,
          characterRef || undefined
        );
        
        updateStep(step.id, { generatedImageUrl: newUrl });
      }

      // Update asset with new image (keep original prompt)
      setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, url: newUrl, timestamp: Date.now(), isPending: false } : a));
    } catch (error) {
      console.error("Error quick regenerating asset:", error);
      setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, isPending: false } : a));
    }
  };

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-8 max-w-[1750px] mx-auto gap-8">
      {/* Studio Header */}
      <header className="flex flex-col gap-6 pb-6 border-b border-white/5">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl font-black font-display tracking-tight text-white uppercase italic leading-none">
                Nano Canvas
              </h1>
              <p className="text-slate-500 text-[7px] font-black uppercase tracking-[0.4em] mt-1">
                Professional Print Architecture
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {activeRoom === "image" && (
              <>
                <button
                  onClick={() => {
                    setSteps(createInitialSteps());
                    setAssets([]);
                  }}
                  className="text-[8px] font-bold text-slate-500 hover:text-white uppercase tracking-widest transition-colors"
                >
                  New Session
                </button>
              </>
            )}
          </div>
        </div>

        {/* Room Selector Menu */}
        <div className="flex items-center gap-2 justify-between w-full">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveRoom("book")}
              className={`px-6 py-2 rounded-lg font-black text-[9px] uppercase tracking-widest transition-all ${
                activeRoom === "book"
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20"
                  : "bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              Book Generator
            </button>
            <button
              onClick={() => setActiveRoom("image")}
              className={`px-6 py-2 rounded-lg font-black text-[9px] uppercase tracking-widest transition-all ${
                activeRoom === "image"
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20"
                  : "bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              Image Room
            </button>
          </div>

          {/* Saved Content Button */}
          <button
            onClick={() => setShowSavedProjects(true)}
            className="p-2 rounded-lg font-black transition-all bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 flex items-center justify-center"
            title="Saved Content"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          </button>
        </div>
      </header>

      {activeRoom === "book" ? (
        <div className="w-full">
          <BookGenerator 
            key={bookGeneratorKey}
            onTransferToImageRoom={(outputs, input, selectedTitle) => {
              // Intelligently transfer all text to Image Room with proper sorting
              transferAllTextToImageRoom(outputs, input, selectedTitle);
              // Switch to Image Room
              setActiveRoom("image");
            }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 overflow-hidden">
          {/* Sidebar Controls */}
          <div className="lg:col-span-3 flex flex-col gap-6 overflow-y-auto custom-scrollbar pr-2">
          <div className="glass-panel p-6 rounded space-y-6">
            <h2 className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-blue-500" />
              Global Constants
            </h2>

            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-1">
                {(["16:9", "21:9", "4:3", "1:1"] as AspectRatio[]).map((ratio) => (
                  <button
                    key={ratio}
                    onClick={() => setConfig((c) => ({ ...c, aspectRatio: ratio }))}
                    className={`py-1.5 text-[8px] font-black rounded border transition-all ${
                      config.aspectRatio === ratio
                        ? "bg-blue-600 border-blue-500 text-white"
                        : "bg-slate-900/50 border-white/5 text-slate-500 hover:border-white/20"
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {(["1K", "2K", "4K"] as const).map((sz) => (
                  <button
                    key={sz}
                    onClick={() => setConfig((c) => ({ ...c, imageSize: sz }))}
                    className={`py-1 px-2 text-[8px] font-black rounded border transition-all ${
                      config.imageSize === sz
                        ? "bg-slate-600 border-slate-500 text-white"
                        : "bg-slate-900/50 border-white/5 text-slate-500 hover:border-white/20"
                    }`}
                  >
                    {sz}
                  </button>
                ))}
                <span className="py-1.5 px-2.5 rounded bg-blue-600 text-white text-[8px] font-black tabular-nums">
                  {(() => {
                    const { width, height } = getOutputDimensions();
                    return `${width}×${height}`;
                  })()}
                </span>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded border border-white/5 group cursor-pointer" onClick={() => setConfig(c => ({...c, demographicExclusion: !c.demographicExclusion}))}>
                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Remove Black People</span>
                <div className={`w-7 h-3.5 rounded-full p-0.5 transition-all ${config.demographicExclusion ? 'bg-blue-600' : 'bg-slate-800'}`}>
                  <div className={`w-2.5 h-2.5 bg-white rounded-full transition-transform ${config.demographicExclusion ? 'translate-x-3.5' : ''}`} />
                </div>
              </div>
            </div>
          </div>

          <div className="glass-panel p-6 rounded space-y-4">
            <h2 className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-orange-500" />
              Master Photo
            </h2>
            <div className="relative aspect-video rounded border-none overflow-hidden transition-all cursor-pointer bg-slate-900">
              <input
                type="file"
                className="absolute inset-0 opacity-0 cursor-pointer z-10"
                onChange={handleCharacterUpload}
              />
              {characterRef ? (
                <img src={characterRef} className="w-full h-full object-cover" alt="Hero Ref" />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center opacity-40 hover:opacity-100 transition-opacity">
                  <svg className="w-5 h-5 mb-2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <span className="text-[8px] font-black uppercase tracking-widest">Protagonist Reference</span>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Story Timeline */}
        <div className="lg:col-span-4 flex flex-col overflow-y-auto custom-scrollbar pr-2">
          <div className="flex items-center justify-between px-2 mb-6">
            <h2 className="text-xs font-black text-white uppercase tracking-widest">Story Timeline</h2>
            <button
              onClick={addSpread}
              className="w-8 h-8 rounded bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center transition-all active:scale-90 shadow-lg shadow-blue-500/10"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {/* Global Rules Section - Always visible */}
            <div className="glass-panel p-4 rounded-lg border border-yellow-500/20 mb-2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[9px] font-black text-yellow-500 uppercase tracking-widest flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                  Global Rules
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setRules([...rules, { id: uuidv4(), text: "" }])}
                    className="text-[7px] font-black text-yellow-500/70 hover:text-yellow-400 uppercase tracking-widest transition-colors flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Rule
                  </button>
                  {rules.length > 0 && (
                    <button
                      onClick={() => setRules([])}
                      className="text-[7px] font-black text-slate-600 hover:text-rose-500 uppercase tracking-widest transition-colors"
                    >
                      Clear All
                    </button>
                  )}
                </div>
              </div>
              {rules.length === 0 ? (
                <p className="text-[8px] text-slate-500 italic">
                  No global rules set. Add rules here or transfer from Book Generator.
                </p>
              ) : (
                <div className="space-y-2">
                  {rules.map((rule, ruleIndex) => (
                    <div key={rule.id} className="relative">
                      <textarea
                        value={rule.text}
                        onChange={(e) => {
                          const newRules = [...rules];
                          newRules[ruleIndex] = { ...rule, text: e.target.value };
                          setRules(newRules);
                        }}
                        placeholder="Enter styling rule (e.g., 'Character Anchor: A 6-year-old boy with brown hair...')"
                        className="w-full bg-slate-900/50 p-3 rounded border border-white/5 text-[9px] text-slate-300 font-mono leading-relaxed focus:border-yellow-500/50 outline-none resize-none min-h-[80px]"
                      />
                      <button
                        onClick={() => setRules(rules.filter((r) => r.id !== rule.id))}
                        className="absolute top-2 right-2 p-1 rounded hover:bg-rose-500/10 text-slate-600 hover:text-rose-500 transition-all"
                        title="Remove rule"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {steps.map((step, idx) => (
              <StepInput
                key={step.id}
                index={idx}
                step={step}
                spreadNumber={getSpreadNumber(step, steps)}
                onUpdate={updateStep}
                onDelete={step.type === "middle" ? deleteStep : undefined}
                onGenerateTitle={step.type === "title" ? handleGenerateTitle : undefined}
                onGenerate={((step.prompt.trim() || step.type === "title") && !isProcessActive) ? () => handleGenerateSingleStep(step.id) : undefined}
                disabled={isProcessActive && !isPaused}
                isSuggestingTitle={step.type === "title" && isSuggestingTitle}
              />
            ))}

            <button
              onClick={addSpread}
              className="w-full py-10 rounded border-none bg-slate-900/20 flex flex-col items-center justify-center gap-3 text-slate-600 hover:text-blue-400 transition-all group"
            >
              <div className="w-10 h-10 rounded bg-slate-900 group-hover:bg-blue-600/10 flex items-center justify-center transition-all">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <span className="text-[8px] font-black uppercase tracking-[0.4em]">Append Step</span>
            </button>
          </div>
        </div>

        {/* Master Monitor & Assets Stack */}
        <div className="lg:col-span-5 flex flex-col gap-8 overflow-y-auto custom-scrollbar">
          {/* Initiate Render Button */}
          <div className="flex justify-end gap-2">
            {isProcessActive ? (
              <>
                {isPaused ? (
                  <button
                    onClick={handleResume}
                    className="px-6 py-4 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 active:scale-95 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Resume
                  </button>
                ) : (
                  <button
                    onClick={handlePause}
                    className="px-6 py-4 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20 active:scale-95 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Pause
                  </button>
                )}
                <button
                  onClick={handleStop}
                  className="px-6 py-4 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20 active:scale-95"
                >
                  Stop
                </button>
              </>
            ) : (
              <button
                onClick={startNarrativeFlow}
                disabled={activeQueueSteps.length === 0}
                className={`w-1/3 px-6 py-4 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all ${
                  activeQueueSteps.length === 0
                    ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                    : "bg-[#3355FF] hover:bg-[#2a44cc] text-white shadow-lg shadow-[#3355FF]/20 active:scale-95"
                }`}
              >
                INITIATE RENDER
              </button>
            )}
          </div>
          
          {/* Monitor */}
          <div className="glass-panel rounded p-6 md:p-8 flex flex-col relative shrink-0 overflow-hidden">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-black text-white uppercase tracking-tighter">Master Monitor</h3>
              {awaitingApproval && (
                <div className="flex items-center gap-3 animate-in slide-in-from-right-10 duration-500">
                  <button
                    onClick={() => executeCurrentStep(activeQueueSteps[currentQueueIndex])}
                    className="px-3 py-1.5 bg-slate-800 text-white text-[8px] font-black rounded uppercase hover:bg-slate-700"
                  >
                    Refine
                  </button>
                  <button
                    onClick={handleApproval}
                    className="px-5 py-1.5 bg-emerald-600 text-white text-[8px] font-black rounded uppercase hover:bg-emerald-500 active:scale-95 shadow shadow-emerald-600/10"
                  >
                    Approve & Next
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 flex flex-col items-center justify-center text-center">
              {selectedAssetForPreview ? (
                // Show selected asset preview
                (() => {
                  const selectedAsset = assets.find(a => a.id === selectedAssetForPreview);
                  if (!selectedAsset) {
                    setSelectedAssetForPreview(null);
                    return null;
                  }
                  return (
                    <div className="w-full space-y-6 animate-in fade-in duration-700">
                      <div
                        className="relative aspect-video w-full rounded-sm overflow-hidden bg-slate-950 border-none shadow-none"
                        style={{ aspectRatio: config.aspectRatio.replace(":", "/") }}
                      >
                        {selectedAsset.isPending ? (
                          <div className="absolute inset-0 bg-slate-950/98 flex flex-col items-center justify-center gap-6 z-50">
                            <div className="w-12 h-12 border-2 border-blue-500/10 border-t-blue-500 rounded-full animate-spin" />
                            <span className="text-[9px] font-black text-blue-500 uppercase tracking-[0.7em] animate-pulse">
                              Generating...
                            </span>
                          </div>
                        ) : (
                          <img
                            src={selectedAsset.url}
                            className="w-full h-full object-cover"
                            alt={selectedAsset.label}
                          />
                        )}
                        <div className="absolute top-4 left-4">
                          <div className="bg-black/20 backdrop-blur-xl px-3 py-1 rounded-full flex items-center gap-2">
                            <div className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
                            <span className="text-[8px] font-black text-white uppercase tracking-[0.2em]">
                              PREVIEW
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="max-w-xl mx-auto px-4">
                        <p className="text-[10px] text-slate-400 font-medium italic leading-relaxed">
                          {selectedAsset.label}
                        </p>
                        <p className="text-[7px] text-slate-500 font-black uppercase tracking-widest mt-2">
                          {new Date(selectedAsset.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  );
                })()
              ) : !currentActiveStep ? (
                <div className="opacity-10 py-16">
                  <svg
                    className="w-24 h-24 text-slate-400 mb-6 mx-auto"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={0.5}
                  >
                    <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <h4 className="text-sm font-black uppercase tracking-[0.6em] text-slate-400">Idle Pipeline</h4>
                </div>
              ) : (
                <div className="w-full space-y-6 animate-in fade-in duration-700">
                  <div
                    className="relative aspect-video w-full rounded-sm overflow-hidden bg-slate-950 border-none shadow-none"
                    style={{ aspectRatio: config.aspectRatio.replace(":", "/") }}
                  >
                    {currentActiveStep.status === "generating" ? (
                      <div className="absolute inset-0 bg-slate-950/98 flex flex-col items-center justify-center gap-6 z-50">
                        <div className="w-12 h-12 border-2 border-blue-500/10 border-t-blue-500 rounded-full animate-spin" />
                        <span className="text-[9px] font-black text-blue-500 uppercase tracking-[0.7em] animate-pulse">
                          Synchronizing: {generationPhase.toUpperCase()}
                        </span>
                      </div>
                    ) : (
                      <>
                        {currentActiveStep.generatedImageUrl && (
                          <img
                            src={currentActiveStep.generatedImageUrl}
                            className="w-full h-full object-cover"
                            alt="Render Output"
                          />
                        )}
                        {currentActiveStep.type !== "cover" && currentActiveStep.textSide !== "none" && (
                          <div
                            className={`absolute inset-0 pointer-events-none transition-all duration-1000 ${
                              currentActiveStep.textSide === "left"
                                ? "bg-gradient-to-r from-black/80 via-black/20 to-transparent"
                                : "bg-gradient-to-l from-black/80 via-black/20 to-transparent"
                            }`}
                          />
                        )}
                      </>
                    )}

                    <div className="absolute top-4 left-4">
                      <div className="bg-black/20 backdrop-blur-xl px-3 py-1 rounded-full flex items-center gap-2">
                        <div className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
                        <span className="text-[8px] font-black text-white uppercase tracking-[0.2em]">
                          {currentActiveStep.type.toUpperCase()} SIGNAL
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="max-w-xl mx-auto px-4">
                    <p className="text-[10px] text-slate-400 font-medium italic leading-relaxed">
                      "{currentActiveStep.prompt || "Synthesizing..."}"
                    </p>
                    {currentActiveStep.storyStyle && (
                      <p className="text-[7px] text-blue-500 font-black uppercase tracking-widest mt-2">
                        Visual Theme: {currentActiveStep.storyStyle}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Assets Stack */}
          <div className="glass-panel rounded p-6 flex flex-col gap-6 shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-tight">Assets Stack</h3>
                <p className="text-[7px] text-slate-500 uppercase tracking-widest mt-1">
                  Export Components: {assets.length}
                </p>
              </div>
              {assets.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setShowAssetGallery(true);
                      setIsGalleryMinimized(false);
                    }}
                    className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white text-[7px] font-black rounded uppercase tracking-widest transition-all flex items-center gap-1.5"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Preview
                  </button>
                  <button
                    onClick={downloadAll}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[7px] font-black rounded uppercase tracking-widest shadow shadow-blue-500/10 transition-all"
                  >
                    Download Stack
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
              {assets.length === 0 ? (
                <div className="py-6 text-center border border-dashed border-white/5 rounded">
                  <span className="text-[8px] text-slate-600 font-black uppercase tracking-widest italic">
                    Gallery Empty
                  </span>
                </div>
              ) : (
                assets.map((asset) => (
                  <div
                    key={asset.id}
                    onClick={() => !asset.isPending && setSelectedAssetForPreview(asset.id)}
                    className={`group flex items-center gap-4 p-2.5 rounded border transition-all animate-in slide-in-from-left-4 duration-300 cursor-pointer ${
                      selectedAssetForPreview === asset.id
                        ? "bg-blue-900/40 border-blue-500/50"
                        : "bg-slate-900/40 border-white/5 hover:border-white/10"
                    } ${asset.isPending ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    <div className="w-16 aspect-video rounded-sm overflow-hidden bg-black shrink-0 flex items-center justify-center">
                      {asset.isPending ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : (
                        <img src={asset.url} className="w-full h-full object-cover" alt={asset.label} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] font-black text-slate-300 uppercase tracking-tight truncate">
                        {asset.label}
                      </p>
                      <p className="text-[7px] text-slate-500 uppercase tracking-widest mt-0.5">
                        {asset.isPending ? "Generating..." : new Date(asset.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                    {asset.isPending ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleRetryStuckAsset(asset); }}
                        className="w-7 h-7 rounded bg-amber-600 hover:bg-amber-500 text-white flex items-center justify-center transition-all"
                        title="Retry (remove stuck)"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); downloadImage(asset.url, asset.label); }}
                        className="w-7 h-7 rounded bg-slate-800 hover:bg-blue-600 text-slate-400 hover:text-white flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        </div>
      )}

      {/* Saved Projects Modal */}
      {showSavedProjects && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowSavedProjects(false)}>
          <div className="glass-panel rounded-2xl p-6 max-w-md w-full mx-4 border border-white/10 max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-black text-white uppercase tracking-widest">Saved Projects</h3>
              <div className="flex items-center gap-3">
                <button
                  onClick={saveCurrentProject}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-black text-[9px] uppercase tracking-widest transition-all"
                >
                  Save Current
                </button>
                <button
                  onClick={() => setShowSavedProjects(false)}
                  className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-all"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
              {savedProjects.length === 0 ? (
                <div className="py-12 text-center">
                  <svg className="w-12 h-12 mx-auto mb-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                  <p className="text-xs text-slate-500 font-black uppercase tracking-widest">No saved projects</p>
                  <p className="text-[9px] text-slate-600 mt-2">Click "Save Current" to save your work</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {savedProjects.map((project) => (
                    <div
                      key={project.id}
                      className="group p-4 bg-slate-900/50 rounded-lg border border-white/5 hover:border-white/20 transition-all"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <h4 className="text-xs font-black text-white uppercase tracking-tight mb-1">{project.name}</h4>
                          <p className="text-[9px] text-slate-400">
                            Saved {new Date(project.savedAt).toLocaleString()}
                          </p>
                        </div>
                        <button
                          onClick={() => deleteProject(project.id)}
                          className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-600 hover:text-rose-500 transition-all opacity-0 group-hover:opacity-100"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[8px] text-slate-500 font-black uppercase tracking-widest">
                        <div>
                          <span className="text-slate-600">Steps:</span> {project.steps.length}
                        </div>
                        <div>
                          <span className="text-slate-600">Assets:</span> {project.assets.length}
                        </div>
                        {project.bookOutputs && (
                          <div className="col-span-2">
                            <span className="text-slate-600">Has Book Data:</span> Yes
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => loadProject(project)}
                        className="w-full mt-3 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-black text-[9px] uppercase tracking-widest transition-all"
                      >
                        Load Project
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Asset Gallery Modal */}
      {showAssetGallery && !isGalleryMinimized && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowAssetGallery(false)}>
          <div className="glass-panel rounded-2xl p-6 max-w-6xl w-full mx-4 border border-white/10 max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 slide-in-from-bottom-4 duration-300" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-black text-white uppercase tracking-widest">Asset Gallery</h3>
              <div className="flex items-center gap-1">
                {/* Minimize button */}
                <button
                  onClick={() => setIsGalleryMinimized(true)}
                  className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition-all"
                  title="Minimize"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                  </svg>
                </button>
                {/* Close button */}
                <button
                  onClick={() => setShowAssetGallery(false)}
                  className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-all"
                  title="Close"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {assets.map((asset) => {
                  // isEditing = edit panel is open for this asset (for input)
                  const isEditing = regeneratingAssetId === asset.id;
                  // isGenerating = actual regeneration in progress (spinner should show)
                  const isGenerating = asset.isPending;
                  // Show spinner ONLY when actually generating, not when just editing
                  const showSpinner = isGenerating;
                  
                  return (
                  <div
                    key={asset.id}
                    className="group relative bg-slate-900/50 rounded-lg border border-white/5 hover:border-white/20 transition-all overflow-hidden"
                  >
                    <div className="aspect-video w-full overflow-hidden bg-black relative">
                      {showSpinner ? (
                        <div className="w-full h-full flex items-center justify-center bg-slate-950">
                          <div className="flex flex-col items-center gap-3">
                            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest">
                              Regenerating...
                            </p>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleRetryStuckAsset(asset); }}
                              className="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white text-[9px] font-black uppercase"
                            >
                              Retry
                            </button>
                          </div>
                        </div>
                      ) : (
                        <img src={asset.url} alt={asset.label} className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="p-3">
                      <p className="text-[9px] font-black text-white uppercase tracking-tight mb-1">{asset.label}</p>
                      <p className="text-[7px] text-slate-500 uppercase tracking-widest mb-3">
                        {showSpinner ? "Regenerating..." : new Date(asset.timestamp).toLocaleString()}
                      </p>
                      
                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            value={regenerateEditPrompt}
                            onChange={(e) => setRegenerateEditPrompt(e.target.value)}
                            placeholder="Describe the changes you want (e.g., 'make it brighter', 'add more trees', 'change the character pose')"
                            className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-[9px] text-white placeholder-slate-500 focus:border-blue-500 outline-none resize-none min-h-[60px]"
                            autoFocus
                            disabled={isGenerating}
                          />
                          {!regenerateEditPrompt.trim() && !isGenerating && (
                            <p className="text-[7px] text-slate-500 uppercase tracking-widest">
                              Enter a description above to enable generation
                            </p>
                          )}
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (regenerateEditPrompt.trim()) {
                                  handleRegenerateAsset(asset);
                                }
                              }}
                              disabled={!regenerateEditPrompt.trim() || isGenerating || assets.some((a) => a.isPending)}
                              className={`flex-1 px-3 py-1.5 rounded-lg font-black text-[8px] uppercase tracking-widest transition-all ${
                                !regenerateEditPrompt.trim() || isGenerating || assets.some((a) => a.isPending)
                                  ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                                  : "bg-blue-600 hover:bg-blue-500 text-white"
                              }`}
                            >
                              {isGenerating ? (
                                <div className="flex items-center justify-center gap-1.5">
                                  <div className="w-2.5 h-2.5 border border-white/30 border-t-white rounded-full animate-spin" />
                                  <span>Regenerating...</span>
                                </div>
                              ) : (
                                "Generate"
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setRegeneratingAssetId(null);
                                setRegenerateEditPrompt("");
                              }}
                              disabled={isGenerating}
                              className={`px-3 py-1.5 rounded-lg font-black text-[8px] uppercase tracking-widest transition-all ${
                                isGenerating
                                  ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                                  : "bg-slate-700 hover:bg-slate-600 text-white"
                              }`}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : !showSpinner && (
                        <div className="flex items-center gap-2">
                          {/* Edit button - opens input for custom changes */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              // Prevent clicking if any regeneration is in progress
                              const isAnyRegenerating = assets.some((a) => a.isPending);
                              if (isAnyRegenerating) return;
                              
                              // Just open the textarea for input - don't start regeneration yet
                              setRegeneratingAssetId(asset.id);
                              setRegenerateEditPrompt("");
                            }}
                            disabled={assets.some((a) => a.isPending)}
                            className={`flex-1 px-3 py-1.5 rounded-lg font-black text-[8px] uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 ${
                              assets.some((a) => a.isPending)
                                ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                                : "bg-emerald-600 hover:bg-emerald-500 text-white"
                            }`}
                            title="Edit with custom instructions"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            Edit
                          </button>
                          {/* Refresh button - regenerates with original prompt only */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleQuickRegenerate(asset);
                            }}
                            disabled={assets.some((a) => a.isPending)}
                            className={`px-3 py-1.5 rounded-lg font-black text-[8px] uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 ${
                              assets.some((a) => a.isPending)
                                ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                                : "bg-blue-600 hover:bg-blue-500 text-white"
                            }`}
                            title="Regenerate with original prompt"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Refresh
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Minimized Asset Gallery - Floating button in bottom-right */}
      {showAssetGallery && isGalleryMinimized && (
        <div 
          className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-10 zoom-in-90 duration-300"
        >
          <button
            onClick={() => setIsGalleryMinimized(false)}
            className="group relative glass-panel rounded-2xl p-4 border border-white/10 hover:border-amber-500/50 transition-all shadow-2xl shadow-black/50 hover:shadow-amber-500/10 hover:scale-105 active:scale-95"
          >
            <div className="flex items-center gap-3">
              {/* Thumbnail preview of latest asset */}
              {assets.length > 0 && (
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-900 border border-white/10">
                  <img 
                    src={assets[0].url} 
                    alt="Latest" 
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="flex flex-col items-start">
                <span className="text-[9px] font-black text-white uppercase tracking-widest">
                  Asset Gallery
                </span>
                <span className="text-[8px] text-slate-400">
                  {assets.length} {assets.length === 1 ? 'asset' : 'assets'}
                  {assets.some(a => a.isPending) && (
                    <span className="ml-2 text-blue-400 animate-pulse">• Generating...</span>
                  )}
                </span>
              </div>
              {/* Expand icon */}
              <div className="ml-2 p-1.5 rounded-lg bg-slate-800/50 group-hover:bg-amber-500/20 transition-colors">
                <svg className="w-4 h-4 text-slate-400 group-hover:text-amber-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              </div>
            </div>
            {/* Close button on minimized view */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowAssetGallery(false);
                setIsGalleryMinimized(false);
              }}
              className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-slate-800 border border-white/10 text-slate-400 hover:text-rose-400 hover:border-rose-500/50 flex items-center justify-center transition-all"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </button>
        </div>
      )}
    </div>
  );
};

export default App;
