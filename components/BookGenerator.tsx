import React, { useState } from "react";
import { BookInput, BookOutputs, BookTextService, Gender } from "../services/bookTextService";

const inputBox =
  "w-full bg-gray-900/50 border border-gray-800 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-blue-500 outline-none transition-colors";

const textArea =
  "w-full bg-gray-950 border border-gray-800 rounded-lg p-3 text-[11px] text-gray-200 focus:border-blue-500 outline-none resize-none font-mono min-h-[140px]";

export default function BookGenerator({
  disabled,
}: {
  disabled?: boolean;
}) {
  const [service] = useState(() => {
    // Service no longer needs API key - handled server-side
    return new BookTextService();
  });

  const [input, setInput] = useState<BookInput>({
    name: "Lukas",
    age: "6",
    gender: "boy",
    interests: ["cars", "dogs"],
    theme: "Adventure",
    lesson: "shy → brave",
  });

  const [outputs, setOutputs] = useState<BookOutputs>({});
  const [busy, setBusy] = useState<null | string>(null);
  const [selectedTitle, setSelectedTitle] = useState<string>("");
  const [error, setError] = useState<string>("");

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

  return (
    <div className="glass-panel rounded-2xl p-5 border border-white/5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[10px] font-black text-gray-100 uppercase tracking-widest">Book Generator</h2>
        {busy && (
          <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest animate-pulse">
            {busy}...
          </span>
        )}
      </div>


      {error && (
        <div className="p-3 mb-4 bg-red-900/30 border border-red-700 rounded-lg">
          <p className="text-[9px] text-red-200">{error}</p>
        </div>
      )}

      {/* INPUTS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <input
          className={inputBox}
          value={input.name}
          onChange={(e) => setInput((p) => ({ ...p, name: e.target.value }))}
          placeholder="Child name"
          disabled={isDisabled}
        />
        <input
          className={inputBox}
          value={input.age}
          onChange={(e) => setInput((p) => ({ ...p, age: e.target.value }))}
          placeholder="Age (e.g. 6 or 5-7)"
          disabled={isDisabled}
        />

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

        <input
          className={inputBox}
          value={input.interests.join(", ")}
          onChange={(e) => setInterests(e.target.value)}
          placeholder="Interests (comma separated, max 3)"
          disabled={isDisabled}
        />

        <input
          className={inputBox}
          value={input.theme}
          onChange={(e) => setInput((p) => ({ ...p, theme: e.target.value }))}
          placeholder="Theme (Adventure / Bedtime / etc.)"
          disabled={isDisabled}
        />

        <input
          className={inputBox}
          value={input.lesson}
          onChange={(e) => setInput((p) => ({ ...p, lesson: e.target.value }))}
          placeholder="Lesson (e.g. shy → brave)"
          disabled={isDisabled}
        />
      </div>

      {/* ACTIONS */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button
          disabled={isDisabled}
          onClick={() =>
            service &&
            run("Generating story", async () => {
              const storyLt = await service.generateStoryLt(input);
              setOutputs((p) => ({ ...p, storyLt }));
            })
          }
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/50 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all"
        >
          Generate Story (LT)
        </button>

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
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900/50 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all"
        >
          Generate Titles (LT)
        </button>

        <button
          disabled={isDisabled || !outputs.storyLt}
          onClick={() =>
            service &&
            run("Generating character anchor", async () => {
              const characterAnchorEn = await service.generateCharacterAnchorEn(input);
              setOutputs((p) => ({ ...p, characterAnchorEn }));
            })
          }
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all"
        >
          Character Anchor (EN)
        </button>

        <button
          disabled={isDisabled || !outputs.storyLt || !outputs.characterAnchorEn}
          onClick={() =>
            service &&
            run("Generating spread prompts", async () => {
              const spreadPromptsEn = await service.generateSpreadPromptsEn(outputs.storyLt!, outputs.characterAnchorEn!);
              setOutputs((p) => ({ ...p, spreadPromptsEn }));
            })
          }
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900/50 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all"
        >
          Spread Prompts (EN)
        </button>

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
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900/50 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all"
        >
          Cover Prompt (EN)
        </button>

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
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-900/50 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all"
        >
          3D Title Prompt (EN)
        </button>
      </div>

      {/* OUTPUTS */}
      <div className="space-y-4">
        <div>
          <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">Story (LT)</div>
          <textarea className={textArea} value={outputs.storyLt || ""} readOnly placeholder="Generate Story (LT)..." />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Titles (LT)</div>
            {chosenTitle ? (
              <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                Using: <span className="text-white">{chosenTitle}</span>
              </div>
            ) : null}
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
          <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">Character Anchor (EN)</div>
          <textarea className={textArea} value={outputs.characterAnchorEn || ""} readOnly placeholder="Character Anchor..." />
        </div>

        <div>
          <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">Spread Prompts (EN)</div>
          <textarea className={textArea} value={outputs.spreadPromptsEn || ""} readOnly placeholder="Spread prompts..." />
        </div>

        <div>
          <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">Cover Prompt (EN)</div>
          <textarea className={textArea} value={outputs.coverPromptEn || ""} readOnly placeholder="Cover prompt..." />
        </div>

        <div>
          <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">3D Title Logo Prompt (EN)</div>
          <textarea className={textArea} value={outputs.titleLogoPromptEn || ""} readOnly placeholder="3D typography prompt..." />
        </div>
      </div>
    </div>
  );
}
