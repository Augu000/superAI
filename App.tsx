
import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ImageStep, GlobalRule, AspectRatio, GlobalConfig, ImageSize } from './types';
import { GeminiService } from './services/geminiService';
import StepInput from './components/StepInput';
import RuleInput from './components/RuleInput';
import BookGenerator from "./components/BookGenerator";


interface RenderedAsset {
  id: string;
  url: string;
  label: string;
  timestamp: number;
}

const App: React.FC = () => {
  const createInitialSteps = (): ImageStep[] => {
    const steps: ImageStep[] = [];
    steps.push({ id: uuidv4(), type: 'cover', prompt: '', status: 'idle', textSide: 'none', bookTitle: '', cast: '', showText: true });
    steps.push({ id: uuidv4(), type: 'first', prompt: '', status: 'idle', textSide: 'none', bookTitle: '', cast: '' });
    steps.push({ id: uuidv4(), type: 'last', prompt: '', status: 'idle', textSide: 'none', bookTitle: '', cast: '' });
    return steps;
  };

  const [steps, setSteps] = useState<ImageStep[]>(createInitialSteps());
  const [rules, setRules] = useState<GlobalRule[]>([]);
  const [characterRef, setCharacterRef] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [config, setConfig] = useState<GlobalConfig>({ aspectRatio: "16:9", imageSize: "1K", bleedPercent: 15, demographicExclusion: false });
  const [isProcessActive, setIsProcessActive] = useState(false);
  const [currentQueueIndex, setCurrentQueueIndex] = useState(-1);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [isSuggestingTitle, setIsSuggestingTitle] = useState(false);
  const [quickPasteText, setQuickPasteText] = useState('');
  const [showQuickPaste, setShowQuickPaste] = useState(false);
  
  // useEffect(() => {
  //   const checkKey = async () => {
  //     // @ts-ignore
  //     const selected = await window.aistudio.hasSelectedApiKey();
  //     setHasKey(selected);
  //   };
  //   checkKey();
  // }, []);
  const [generationPhase, setGenerationPhase] = useState<'idle' | 'background' | 'title' | 'cast' | 'scene'>('idle');
  const [assets, setAssets] = useState<RenderedAsset[]>([]);

  useEffect(() => {
  setHasKey(true); // local dev: use .env.local key
}, []);

  const getGemini = () => new GeminiService();
  
  const handleSelectKey = async () => {
    // @ts-ignore
    await window.aistudio.openSelectKey();
    setHasKey(true);
  };

  // const handleSelectKey = async () => {
  //   // @ts-ignore
  //   await window.aistudio.openSelectKey();
  //   setHasKey(true);
  // };

const handleSelectKey = async () => {
  setHasKey(true);
};


  const handleCharacterUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setCharacterRef(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const updateStep = (id: string, updates: Partial<ImageStep>) => setSteps(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  const deleteStep = (id: string) => setSteps(prev => prev.filter(s => s.id !== id));
  
  const addAsset = (url: string, label: string) => {
    setAssets(prev => [{ id: uuidv4(), url, label, timestamp: Date.now() }, ...prev]);
  };

  const addSpread = () => {
    setSteps(prev => {
      const newSteps = [...prev];
      const lastIdx = newSteps.findIndex(s => s.type === 'last');
      newSteps.splice(lastIdx, 0, { id: uuidv4(), type: 'middle', prompt: '', status: 'idle', textSide: 'none' });
      return newSteps;
    });
  };

  const handleQuickPaste = () => {
    if (!quickPasteText.trim()) return;
    const spreadBlocks = quickPasteText.split(/(?=Spread \d+)|(?=COVER\b)/i).filter(b => b.trim());
    const middlePrompts: string[] = [];
    let coverPrompt = "";
    spreadBlocks.forEach(block => {
      const trimmed = block.trim();
      const lower = trimmed.toLowerCase();
      if (lower.startsWith('spread')) {
        const clean = trimmed.replace(/Spread \d+\s*\(SCENE\):/gi, '').trim();
        if (clean) middlePrompts.push(clean);
      } else if (lower.startsWith('cover')) {
        const clean = trimmed.replace(/COVER/gi, '').trim();
        if (clean) coverPrompt = clean;
      }
    });

    setSteps(prev => {
      const cover = prev.find(s => s.type === 'cover')!;
      const first = prev.find(s => s.type === 'first')!;
      const last = prev.find(s => s.type === 'last')!;
      const middleSteps: ImageStep[] = middlePrompts.map(prompt => ({
        id: uuidv4(), type: 'middle', prompt, status: 'idle', textSide: 'none'
      }));
      return [
        { ...cover, prompt: coverPrompt || cover.prompt },
        { ...first, prompt: 'Cinematic Logo' },
        ...middleSteps,
        { ...last, prompt: 'Closing Card' }
      ];
    });
    setQuickPasteText('');
    setShowQuickPaste(false);
  };

  const executeCurrentStep = async (index: number) => {
    if (!hasKey) await handleSelectKey();
    const step = steps[index];
    setSteps(prev => prev.map((s, idx) => idx === index ? { ...s, status: 'generating' } : s));
    
    try {
      const gemini = getGemini();
      const ruleTexts = rules.map(r => r.text).filter(t => t.trim().length > 0);
      const previousImage = index > 0 ? steps[index-1].generatedImageUrl : undefined;

      if (step.type === 'cover') {
        if (step.showText) {
          setGenerationPhase('title');
          const titleUrl = await gemini.generateStepImage({ ...step, coverPart: 'title' }, ruleTexts, config);
          updateStep(step.id, { generatedTitleUrl: titleUrl });
          addAsset(titleUrl, "Cover Title Layer");

          setGenerationPhase('cast');
          const castUrl = await gemini.generateStepImage({ ...step, coverPart: 'cast' }, ruleTexts, config);
          updateStep(step.id, { generatedCastUrl: castUrl });
          addAsset(castUrl, "Cover Cast Layer");
        }

        setGenerationPhase('background');
        const bgUrl = await gemini.generateStepImage({ ...step, coverPart: 'background' }, ruleTexts, config, previousImage, characterRef || undefined);
        updateStep(step.id, { generatedImageUrl: bgUrl });
        addAsset(bgUrl, "Cover Background (Seamless)");
        
        setSteps(prev => prev.map((s, idx) => idx === index ? { ...s, status: 'completed' } : s));
      } else {
        setGenerationPhase('scene');
        const imageUrl = await gemini.generateStepImage(step, ruleTexts, config, previousImage, characterRef || undefined);
        setSteps(prev => prev.map((s, idx) => idx === index ? { ...s, status: 'completed', generatedImageUrl: imageUrl } : s));
        addAsset(imageUrl, step.type === 'first' ? "Intro Card" : step.type === 'last' ? "Ending Card" : `Spread ${index-1} Artwork`);
      }
      setGenerationPhase('idle');
      setAwaitingApproval(true);
    } catch (err: any) {
      setSteps(prev => prev.map((s, idx) => idx === index ? { ...s, status: 'error', error: err.message } : s));
      setIsProcessActive(false);
      setGenerationPhase('idle');
    }
  };

  const startNarrativeFlow = async () => {
    const queue = activeQueueSteps;
    if (queue.length === 0) return;
    setIsProcessActive(true);
    setCurrentQueueIndex(0);
    setAwaitingApproval(false);
    await executeCurrentStep(queue[0]);
  };

  const handleApproval = async () => {
    const queue = activeQueueSteps;
    const nextQueueIdx = currentQueueIndex + 1;
    if (nextQueueIdx < queue.length) {
      setCurrentQueueIndex(nextQueueIdx);
      setAwaitingApproval(false);
      await executeCurrentStep(queue[nextQueueIdx]);
    } else {
      setIsProcessActive(false);
      setCurrentQueueIndex(-1);
    }
  };

  const handleGenerateTitle = async (id: string) => {
    if (isSuggestingTitle) return;
    setIsSuggestingTitle(true);
    try {
      const gemini = getGemini();
      const allPrompts = steps.map(s => s.prompt).filter(p => p && p.trim().length > 0);
      const analysis = await gemini.analyzeStory(allPrompts);
      
      updateStep(id, { bookTitle: analysis.title, storyStyle: analysis.visualStyle });
      
      // Sync style across pages for consistency
      const firstPage = steps.find(s => s.type === 'first');
      if (firstPage) updateStep(firstPage.id, { bookTitle: analysis.title, storyStyle: analysis.visualStyle });
      
      const lastPage = steps.find(s => s.type === 'last');
      if (lastPage) updateStep(lastPage.id, { storyStyle: analysis.visualStyle });
    } finally {
      setIsSuggestingTitle(false);
    }
  };

  const downloadImage = (url: string, label: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${label.replace(/\s+/g, '_')}_${Date.now()}.png`;
    link.click();
  };

  const downloadAll = () => {
    assets.forEach((asset, idx) => {
      setTimeout(() => downloadImage(asset.url, asset.label), idx * 300);
    });
  };

  const activeQueueSteps = steps.map((s, i) => (s.prompt.trim() || s.type === 'cover' || s.type === 'first' || s.type === 'last') ? i : -1).filter(i => i !== -1);
  const currentActiveStep = currentQueueIndex >= 0 ? steps[activeQueueSteps[currentQueueIndex]] : null;

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-8 max-w-[1750px] mx-auto gap-8">
      {/* Studio Header */}
      <header className="flex flex-col lg:flex-row items-center justify-between gap-6 pb-6 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/10">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          </div>
          <div>
            <h1 className="text-xl font-black font-display tracking-tight text-white uppercase italic leading-none">Nano Canvas</h1>
            <p className="text-slate-500 text-[7px] font-black uppercase tracking-[0.4em] mt-1">Professional Print Architecture</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={startNarrativeFlow} 
            disabled={isProcessActive || steps.every(s => !s.prompt.trim())}
            className={`px-10 py-3 rounded font-black text-[9px] uppercase tracking-[0.2em] transition-all ${isProcessActive ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white shadow active:scale-95'}`}
          >
            {isProcessActive ? 'Session Active' : 'Initiate Render'}
          </button>
          <div className="h-6 w-px bg-white/5 mx-2" />
          <button onClick={() => {setSteps(createInitialSteps()); setAssets([]);}} className="text-[8px] font-bold text-slate-500 hover:text-white uppercase tracking-widest transition-colors">New Session</button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 overflow-hidden">
        {/* Sidebar Controls */}
        <div className="lg:col-span-3 flex flex-col gap-6 overflow-y-auto custom-scrollbar pr-2">
           <div className="glass-panel p-6 rounded space-y-6">
              <h2 className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-blue-500" />Global Constants</h2>
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-1">
                  {(['16:9', '4:3', '1:1'] as AspectRatio[]).map(ratio => (
                    <button key={ratio} onClick={() => setConfig(c => ({...c, aspectRatio: ratio}))} className={`py-1.5 text-[8px] font-black rounded border transition-all ${config.aspectRatio === ratio ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900/50 border-white/5 text-slate-500 hover:border-white/20'}`}>{ratio}</button>
                  ))}
                </div>
                <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded border border-white/5 group cursor-pointer" onClick={() => setConfig(c => ({...c, demographicExclusion: !c.demographicExclusion}))}>
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Remove Black People</span>
                  <div className={`w-7 h-3.5 rounded-full p-0.5 transition-all ${config.demographicExclusion ? 'bg-blue-600' : 'bg-slate-800'}`}><div className={`w-2.5 h-2.5 bg-white rounded-full transition-transform ${config.demographicExclusion ? 'translate-x-3.5' : ''}`} /></div>
                </div>
              </div>
           </div>

           <div className="glass-panel p-6 rounded space-y-4">
              <h2 className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-orange-500" />Master Photo</h2>
              <div className="relative aspect-video rounded border-none overflow-hidden transition-all cursor-pointer bg-slate-900">
                <input type="file" className="absolute inset-0 opacity-0 cursor-pointer z-10" onChange={handleCharacterUpload} />
                {characterRef ? (
                  <img src={characterRef} className="w-full h-full object-cover" alt="Hero Ref" />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center opacity-40 hover:opacity-100 transition-opacity">
                    <svg className="w-5 h-5 mb-2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    <span className="text-[8px] font-black uppercase tracking-widest">Protagonist Reference</span>
                  </div>
                )}
              </div>
           </div>

           <div className="glass-panel p-6 rounded space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-purple-500" />Script Ingest</h2>
                <button onClick={() => setShowQuickPaste(!showQuickPaste)} className="p-1 rounded hover:bg-white/5 transition-colors text-slate-500"><svg className={`w-3 h-3 transition-transform ${showQuickPaste ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M19 9l-7 7-7-7" /></svg></button>
              </div>
              {showQuickPaste && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
                  <textarea 
                    value={quickPasteText} 
                    onChange={e => setQuickPasteText(e.target.value)} 
                    placeholder="Paste script blocks..." 
                    className="w-full h-32 bg-slate-900/50 border border-white/5 rounded p-3 text-[9px] text-slate-300 focus:border-purple-500/50 outline-none resize-none custom-scrollbar"
                  />
                  <button onClick={handleQuickPaste} className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded font-black text-[9px] uppercase tracking-widest transition-all shadow-lg shadow-purple-600/10">Process Script</button>
                </div>
              )}
           </div>
        </div>

        {/* Story Timeline */}
        <div className="lg:col-span-4 flex flex-col overflow-y-auto custom-scrollbar pr-2">
           <div className="flex items-center justify-between px-2 mb-6">
              <h2 className="text-xs font-black text-white uppercase tracking-widest">Story Timeline</h2>
              <button onClick={addSpread} className="w-8 h-8 rounded bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center transition-all active:scale-90 shadow-lg shadow-blue-500/10"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg></button>
           </div>
           <div className="flex flex-col gap-3">
              {steps.map((step, idx) => (
                <StepInput 
                  key={step.id} 
                  index={idx} 
                  step={step} 
                  onUpdate={updateStep} 
                  onDelete={step.type === 'middle' ? deleteStep : undefined} 
                  onGenerateTitle={step.type === 'cover' ? handleGenerateTitle : undefined} 
                  disabled={isProcessActive} 
                  isSuggestingTitle={step.type === 'cover' && isSuggestingTitle}
                />
              ))}
              <button onClick={addSpread} className="w-full py-10 rounded border-none bg-slate-900/20 flex flex-col items-center justify-center gap-3 text-slate-600 hover:text-blue-400 transition-all group">
                <div className="w-10 h-10 rounded bg-slate-900 group-hover:bg-blue-600/10 flex items-center justify-center transition-all"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeWidth={2} d="M12 4v16m8-8H4" /></svg></div>
                <span className="text-[8px] font-black uppercase tracking-[0.4em]">Append Step</span>
              </button>
           </div>
            </div>
          </section>

          <section className="glass-panel p-5 rounded-2xl border-l-4 border-l-indigo-500">
             <div className="flex items-center justify-between mb-4">
              <h2 className="text-[10px] font-black text-gray-100 uppercase tracking-widest">Aesthetic Rules</h2>
              <button onClick={addRule} className="text-blue-400 hover:text-blue-300 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
              </button>
            </div>
            <div className="space-y-2 max-h-[100px] overflow-y-auto pr-1 custom-scrollbar">
              {rules.length === 0 ? (
                <p className="text-[9px] text-gray-600 italic uppercase">No rules defined.</p>
              ) : (
                rules.map(rule => <RuleInput key={rule.id} rule={rule} onUpdate={updateRule} onRemove={removeRule} />)
              )}
            </div>
          </section>

          <BookGenerator
  hasKey={hasKey}
  onSelectKey={handleSelectKey}
  disabled={isProcessActive || isSuggestingTitle}
/>

          <section className="glass-panel p-4 rounded-2xl border-l-4 border-l-purple-500 bg-purple-500/5">
            <button onClick={() => setShowBulkImport(!showBulkImport)} className="flex items-center justify-between w-full">
              <h2 className="text-[10px] font-black text-gray-100 uppercase tracking-widest">Bulk Story Ingest</h2>
              <div className={`p-1 rounded-full bg-white/5 transition-transform ${showBulkImport ? 'rotate-180' : ''}`}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </div>
            </button>
            {showBulkImport && (
              <div className="mt-4 space-y-3">
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder="Spread 1 (SCENE): ... &#10;COVER ..."
                  className="w-full h-32 bg-gray-950 border border-gray-800 rounded-lg p-3 text-[10px] text-gray-300 focus:border-purple-500 outline-none resize-none font-mono"
                />
                <button onClick={handleBulkDistribute} disabled={!bulkText.trim()} className="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-900/50 text-white rounded-lg font-black text-[9px] uppercase tracking-widest transition-all">
                  Process Narrative
                </button>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3 overflow-y-auto max-h-[calc(100vh-600px)] lg:max-h-[600px] pb-10 pr-1 custom-scrollbar">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Story Sequence</h3>
              <button 
                onClick={addSpread}
                disabled={isProcessActive}
                className="text-[9px] font-black text-blue-500 hover:text-blue-400 uppercase tracking-widest transition-colors flex items-center gap-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
                Add Spread
              </button>
            </div>
            {steps.map((step, idx) => (
              <StepInput 
                key={step.id} 
                index={idx} 
                step={step} 
                onUpdate={updateStep} 
                onDelete={step.type === 'middle' ? deleteStep : undefined}
                onGenerateTitle={step.type === 'cover' ? handleGenerateTitle : undefined}
                disabled={isProcessActive || isSuggestingTitle} 
              />
            ))}
          </section>
        </div>

        {/* Master Monitor & Assets Stack */}
        <div className="lg:col-span-5 flex flex-col gap-8 overflow-y-auto custom-scrollbar">
           {/* Monitor */}
           <div className="glass-panel rounded p-6 md:p-8 flex flex-col relative shrink-0 overflow-hidden">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-black text-white uppercase tracking-tighter">Master Monitor</h3>
                {awaitingApproval && (
                  <div className="flex items-center gap-3 animate-in slide-in-from-right-10 duration-500">
                    <button onClick={() => executeCurrentStep(activeQueueSteps[currentQueueIndex])} className="px-3 py-1.5 bg-slate-800 text-white text-[8px] font-black rounded uppercase hover:bg-slate-700">Refine</button>
                    <button onClick={handleApproval} className="px-5 py-1.5 bg-emerald-600 text-white text-[8px] font-black rounded uppercase hover:bg-emerald-500 active:scale-95 shadow shadow-emerald-600/10">Approve & Next</button>
                  </div>
                )}
              </div>

              <div className="flex-1 flex flex-col items-center justify-center text-center">
                {!currentActiveStep ? (
                  <div className="opacity-10 py-16">
                    <svg className="w-24 h-24 text-slate-400 mb-6 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    <h4 className="text-sm font-black uppercase tracking-[0.6em] text-slate-400">Idle Pipeline</h4>
                  </div>
                ) : (
                  <div className="w-full space-y-6 animate-in fade-in duration-700">
                    <div className="relative aspect-video w-full rounded-sm overflow-hidden bg-slate-950 border-none shadow-none" style={{ aspectRatio: config.aspectRatio.replace(':', '/') }}>
                       {currentActiveStep.status === 'generating' ? (
                         <div className="absolute inset-0 bg-slate-950/98 flex flex-col items-center justify-center gap-6 z-50">
                           <div className="w-12 h-12 border-2 border-blue-500/10 border-t-blue-500 rounded-full animate-spin" />
                           <span className="text-[9px] font-black text-blue-500 uppercase tracking-[0.7em] animate-pulse">Synchronizing: {generationPhase.toUpperCase()}</span>
                         </div>
                       ) : (
                         <>
                           {currentActiveStep.generatedImageUrl && (
                             <img src={currentActiveStep.generatedImageUrl} className="w-full h-full object-cover" alt="Render Output" />
                           )}
                           {currentActiveStep.type !== 'cover' && currentActiveStep.textSide !== 'none' && (
                             <div className={`absolute inset-0 pointer-events-none transition-all duration-1000 ${currentActiveStep.textSide === 'left' ? 'bg-gradient-to-r from-black/80 via-black/20 to-transparent' : 'bg-gradient-to-l from-black/80 via-black/20 to-transparent'}`} />
                           )}
                         </>
                       )}
                       <div className="absolute top-4 left-4">
                         <div className="bg-black/20 backdrop-blur-xl px-3 py-1 rounded-full flex items-center gap-2">
                            <div className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
                            <span className="text-[8px] font-black text-white uppercase tracking-[0.2em]">{currentActiveStep.type.toUpperCase()} SIGNAL</span>
                         </div>
                       </div>
                    </div>
                    <div className="max-w-xl mx-auto px-4">
                      <p className="text-[10px] text-slate-400 font-medium italic leading-relaxed">"{currentActiveStep.prompt || 'Synthesizing...'}"</p>
                      {currentActiveStep.storyStyle && (
                        <p className="text-[7px] text-blue-500 font-black uppercase tracking-widest mt-2">Visual Theme: {currentActiveStep.storyStyle}</p>
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
                  <p className="text-[7px] text-slate-500 uppercase tracking-widest mt-1">Export Components: {assets.length}</p>
                </div>
                {assets.length > 0 && (
                  <button onClick={downloadAll} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[7px] font-black rounded uppercase tracking-widest shadow shadow-blue-500/10 transition-all">Download Stack</button>
                )}
              </div>

              <div className="flex flex-col gap-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                {assets.length === 0 ? (
                  <div className="py-6 text-center border border-dashed border-white/5 rounded">
                    <span className="text-[8px] text-slate-600 font-black uppercase tracking-widest italic">Gallery Empty</span>
                  </div>
                ) : (
                  assets.map(asset => (
                    <div key={asset.id} className="group flex items-center gap-4 p-2.5 bg-slate-900/40 rounded border border-white/5 hover:border-white/10 transition-all animate-in slide-in-from-left-4 duration-300">
                      <div className="w-16 aspect-video rounded-sm overflow-hidden bg-black shrink-0">
                        <img src={asset.url} className="w-full h-full object-cover" alt={asset.label} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[9px] font-black text-slate-300 uppercase tracking-tight truncate">{asset.label}</p>
                        <p className="text-[7px] text-slate-500 uppercase tracking-widest mt-0.5">{new Date(asset.timestamp).toLocaleTimeString()}</p>
                      </div>
                      <button onClick={() => downloadImage(asset.url, asset.label)} className="w-7 h-7 rounded bg-slate-800 hover:bg-blue-600 text-slate-400 hover:text-white flex items-center justify-center transition-all opacity-0 group-hover:opacity-100">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      </button>
                    </div>
                  ))
                )}
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default App;
