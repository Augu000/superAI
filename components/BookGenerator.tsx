import React, { useState, useEffect } from "react";
import { BookInput, BookOutputs, BookTextService, Gender } from "../services/bookTextService";

const STORAGE_KEY_INPUT = "bookGenerator_input";
const STORAGE_KEY_OUTPUTS = "bookGenerator_outputs";
const STORAGE_KEY_SELECTED_TITLE = "bookGenerator_selectedTitle";

const inputBox =
  "w-full bg-gray-900/50 border border-gray-800 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-blue-500 outline-none transition-colors";

const textArea =
  "w-full bg-gray-950 border border-gray-800 rounded-lg p-3 text-[11px] text-gray-200 focus:border-blue-500 outline-none resize-none font-mono min-h-[140px]";

export default function BookGenerator({
  disabled,
  onTransferToImageRoom,
}: {
  disabled?: boolean;
  onTransferToImageRoom?: (outputs: BookOutputs, input: BookInput, selectedTitle: string) => void;
}) {
  const [service] = useState(() => {
    // Service no longer needs API key - handled server-side
    return new BookTextService();
  });

  // Load from localStorage on mount
  const loadFromStorage = (): { input: BookInput; outputs: BookOutputs; selectedTitle: string } => {
    try {
      const savedInput = localStorage.getItem(STORAGE_KEY_INPUT);
      const savedOutputs = localStorage.getItem(STORAGE_KEY_OUTPUTS);
      const savedSelectedTitle = localStorage.getItem(STORAGE_KEY_SELECTED_TITLE);

      return {
        input: savedInput ? JSON.parse(savedInput) : {
          name: "Lukas",
          age: "6",
          gender: "boy",
          interests: ["cars", "dogs"],
          theme: "Adventure",
          lesson: "shy → brave",
        },
        outputs: savedOutputs ? JSON.parse(savedOutputs) : {},
        selectedTitle: savedSelectedTitle || "",
      };
    } catch (e) {
      console.error("Error loading from localStorage:", e);
      return {
        input: {
          name: "Lukas",
          age: "6",
          gender: "boy",
          interests: ["cars", "dogs"],
          theme: "Adventure",
          lesson: "shy → brave",
        },
        outputs: {},
        selectedTitle: "",
      };
    }
  };

  const initialData = loadFromStorage();
  const [input, setInput] = useState<BookInput>(initialData.input);
  const [outputs, setOutputs] = useState<BookOutputs>(initialData.outputs);
  const [busy, setBusy] = useState<null | string>(null);
  const [selectedTitle, setSelectedTitle] = useState<string>(initialData.selectedTitle);
  const [error, setError] = useState<string>("");

  // Save to localStorage whenever input, outputs, or selectedTitle changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_INPUT, JSON.stringify(input));
    } catch (e) {
      console.error("Error saving input to localStorage:", e);
    }
  }, [input]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_OUTPUTS, JSON.stringify(outputs));
    } catch (e) {
      console.error("Error saving outputs to localStorage:", e);
    }
  }, [outputs]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SELECTED_TITLE, selectedTitle);
    } catch (e) {
      console.error("Error saving selectedTitle to localStorage:", e);
    }
  }, [selectedTitle]);

  const isDisabled = !!disabled || !!busy || !service;

  const setInterests = (v: string) => {
    const arr = v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
    setInput((p) => ({ ...p, interests: arr }));
  };

  const titlesList = service
    ? (outputs.titlesLt ? service.parseTitlesLt(outputs.titlesLt) : [])
    : [];

  const chosenTitle = service && outputs.titlesLt
    ? service.pickTitleFromTitlesLt(outputs.titlesLt, selectedTitle)
    : selectedTitle || "";

  const run = async (label: string, fn: () => Promise<void>) => {
    try {
      setBusy(label);
      setError("");
      await fn();
    } catch (err) {
      setError((err instanceof Error ? err.message : String(err)) || "Unknown error");
    } finally {
      setBusy(null);
    }
  };

  const isReadyForTransfer = !!outputs.spreadPromptsEn && !!outputs.coverPromptEn && !!outputs.storyLt && !!outputs.characterAnchorEn;
  const hasAnyOutputs = !!outputs.spreadPromptsEn || !!outputs.coverPromptEn || !!outputs.storyLt;

  return (
    <div className="glass-panel rounded-2xl p-5 border border-white/5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[10px] font-black text-gray-100 uppercase tracking-widest">Book Generator</h2>
        <div className="flex items-center gap-3">
          {busy && (
            <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest animate-pulse">
              {busy}...
            </span>
          )}
          {onTransferToImageRoom && (
            <button
              onClick={() => onTransferToImageRoom(outputs, input, chosenTitle)}
              disabled={!isReadyForTransfer}
              className={`px-4 py-2 rounded-lg font-black text-[9px] uppercase tracking-widest transition-all ${
                isReadyForTransfer
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 cursor-pointer"
                  : "bg-slate-800 text-slate-500 cursor-not-allowed"
              }`}
              title={
                isReadyForTransfer
                  ? "Transfer all text to Image Room and auto-sort into cover, intro, spreads, and closing"
                  : "Generate all outputs (Story, Titles, Spread Prompts, Cover Prompt, Character Anchor) to enable transfer"
              }
            >
              Transfer to Image Room
            </button>
          )}
        </div>
      </div>


      {error && (
        <div className="p-3 mb-4 bg-red-900/30 border border-red-700 rounded-lg">
          <p className="text-[9px] text-red-200">{error}</p>
        </div>
      )}

      {/* INPUTS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Child Name</label>
          <input
            className={inputBox}
            value={input.name}
            onChange={(e) => setInput((p) => ({ ...p, name: e.target.value }))}
            placeholder="Child name"
            disabled={isDisabled}
          />
        </div>
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Age</label>
          <input
            className={inputBox}
            value={input.age}
            onChange={(e) => setInput((p) => ({ ...p, age: e.target.value }))}
            placeholder="Age (e.g. 6 or 5-7)"
            disabled={isDisabled}
          />
        </div>

        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Gender</label>
          <select
            className={inputBox}
            value={input.gender}
            onChange={(e) => setInput((p) => ({ ...p, gender: e.target.value as Gender }))}
            disabled={isDisabled}
          >
            <option value="boy">boy</option>
            <option value="girl">girl</option>
            <option value="neutral">neutral</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Interests</label>
          <input
            className={inputBox}
            value={input.interests.join(", ")}
            onChange={(e) => setInterests(e.target.value)}
            placeholder="Interests (comma separated, max 3)"
            disabled={isDisabled}
          />
        </div>

        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Theme</label>
          <input
            className={inputBox}
            value={input.theme}
            onChange={(e) => setInput((p) => ({ ...p, theme: e.target.value }))}
            placeholder="Theme (Adventure / Bedtime / etc.)"
            disabled={isDisabled}
          />
        </div>

        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Lesson</label>
          <input
            className={inputBox}
            value={input.lesson}
            onChange={(e) => setInput((p) => ({ ...p, lesson: e.target.value }))}
            placeholder="Lesson (e.g. shy → brave)"
            disabled={isDisabled}
          />
        </div>
      </div>

      {/* OUTPUTS */}
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Story (LT)</div>
            <button
              disabled={isDisabled}
              onClick={() =>
                service &&
                run("Generating story", async () => {
                  const storyLt = await service.generateStoryLt(input);
                  setOutputs((p) => ({ ...p, storyLt }));
                })
              }
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/50 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2"
            >
              {busy === "Generating story" && (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              Generate Story (LT)
            </button>
          </div>
          <textarea className={textArea} value={outputs.storyLt || ""} readOnly placeholder="Generate Story (LT)..." />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Titles (LT)</div>
            <div className="flex items-center gap-2">
              {chosenTitle ? (
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                  Using: <span className="text-white">{chosenTitle}</span>
                </div>
              ) : null}
              <button
                disabled={isDisabled || !outputs.storyLt}
                onClick={() =>
                  service &&
                  run("Generating titles", async () => {
                    const titlesLt = await service.generateTitlesLt(input, outputs.storyLt!);
                    setOutputs((p) => ({ ...p, titlesLt }));

                    // Auto-pick first title so dropdown has a default
                    const parsed = service.parseTitlesLt(titlesLt);
                    if (parsed.length > 0) setSelectedTitle(parsed[0]);
                  })
                }
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900/50 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2"
              >
                {busy === "Generating titles" && (
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                )}
                Generate Titles (LT)
              </button>
            </div>
          </div>

          <textarea className={textArea} value={outputs.titlesLt || ""} readOnly placeholder="Generate Titles (LT)..." />

          {/* Title selector */}
          {outputs.titlesLt && titlesList.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">
                Select title to use for cover/logo
              </div>
              <select
                className={inputBox}
                value={selectedTitle}
                onChange={(e) => setSelectedTitle(e.target.value)}
                disabled={isDisabled}
              >
                {titlesList.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Character Anchor (EN)</div>
            <button
              disabled={isDisabled || !outputs.storyLt}
              onClick={() =>
                service &&
                run("Generating character anchor", async () => {
                  const characterAnchorEn = await service.generateCharacterAnchorEn(input);
                  setOutputs((p) => ({ ...p, characterAnchorEn }));
                })
              }
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2"
            >
              {busy === "Generating character anchor" && (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              Character Anchor (EN)
            </button>
          </div>
          <textarea className={textArea} value={outputs.characterAnchorEn || ""} readOnly placeholder="Character Anchor..." />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Spread Prompts (EN)</div>
            <button
              disabled={isDisabled || !outputs.storyLt || !outputs.characterAnchorEn}
              onClick={() =>
                service &&
                run("Generating spread prompts", async () => {
                  const spreadPromptsEn = await service.generateSpreadPromptsEn(outputs.storyLt!, outputs.characterAnchorEn!);
                  setOutputs((p) => ({ ...p, spreadPromptsEn }));
                })
              }
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900/50 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2"
            >
              {busy === "Generating spread prompts" && (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              Spread Prompts (EN)
            </button>
          </div>
          <textarea className={textArea} value={outputs.spreadPromptsEn || ""} readOnly placeholder="Spread prompts..." />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Cover Prompt (EN)</div>
            <button
              disabled={isDisabled || !outputs.storyLt || !outputs.characterAnchorEn}
              onClick={() =>
                service &&
                run("Generating cover prompt", async () => {
                  const title = chosenTitle || "Untitled";
                  const coverPromptEn = await service.generateCoverPromptEn(
                    outputs.storyLt!,
                    input.name,
                    input.theme,
                    title,
                    outputs.characterAnchorEn!
                  );
                  setOutputs((p) => ({ ...p, coverPromptEn }));
                })
              }
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900/50 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2"
            >
              {busy === "Generating cover prompt" && (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              Cover Prompt (EN)
            </button>
          </div>
          <textarea className={textArea} value={outputs.coverPromptEn || ""} readOnly placeholder="Cover prompt..." />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest">3D Title Logo Prompt (EN)</div>
            <button
              disabled={isDisabled || !outputs.titlesLt}
              onClick={() =>
                service &&
                run("Generating 3D title prompt", async () => {
                  const title = chosenTitle || "Untitled";
                  const titleLogoPromptEn = await service.generateTitleLogoPromptEn(title, input.theme);
                  setOutputs((p) => ({ ...p, titleLogoPromptEn }));
                })
              }
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-900/50 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2"
            >
              {busy === "Generating 3D title prompt" && (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              3D Title Prompt (EN)
            </button>
          </div>
          <textarea className={textArea} value={outputs.titleLogoPromptEn || ""} readOnly placeholder="3D typography prompt..." />
        </div>
      </div>
    </div>
  );
}
