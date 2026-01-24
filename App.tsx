import React, { useState, useCallback, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ImageStep, GlobalRule, AspectRatio, GlobalConfig, ImageSize } from './types';
import { GeminiService } from './services/geminiService';
import StepInput from './components/StepInput';
import RuleInput from './components/RuleInput';
import BookGenerator from "./components/BookGenerator";


const MAX_MIDDLE_STEPS = 15;

const App: React.FC = () => {
  const createInitialSteps = (): ImageStep[] => {
    const steps: ImageStep[] = [];
    steps.push({ id: uuidv4(), type: 'cover', prompt: '', status: 'idle', textSide: 'none', bookTitle: '', cast: '', showText: true });
    steps.push({ id: uuidv4(), type: 'first', prompt: '', status: 'idle', textSide: 'none', bookTitle: '', cast: '' });
    for (let i = 0; i < 3; i++) {
      steps.push({ id: uuidv4(), type: 'middle', prompt: '', status: 'idle', textSide: 'none' });
    }
    steps.push({ id: uuidv4(), type: 'last', prompt: '', status: 'idle', textSide: 'none', bookTitle: '', cast: '' });
    return steps;
  };

  const [steps, setSteps] = useState<ImageStep[]>(createInitialSteps());
  const [rules, setRules] = useState<GlobalRule[]>([]);
  const [characterRef, setCharacterRef] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  
  const [config, setConfig] = useState<GlobalConfig>({
    aspectRatio: "16:9",
    imageSize: "1K",
    bleedPercent: 5,
    demographicExclusion: false
  });

  const [isProcessActive, setIsProcessActive] = useState(false);
  const [currentQueueIndex, setCurrentQueueIndex] = useState(-1);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [isSuggestingTitle, setIsSuggestingTitle] = useState(false);
  
  const [bulkText, setBulkText] = useState('');
  const [showBulkImport, setShowBulkImport] = useState(false);
  
  useEffect(() => {
    const checkKey = async () => {
      // @ts-ignore
      const selected = await window.aistudio.hasSelectedApiKey();
      setHasKey(selected);
    };
    checkKey();
  }, []);



  const handleSelectKey = async () => {
    // @ts-ignore
    await window.aistudio.openSelectKey();
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

  const updateStep = (id: string, updates: Partial<ImageStep>) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const deleteStep = (id: string) => {
    setSteps(prev => prev.filter(s => s.id !== id));
  };

  const addSpread = () => {
    setSteps(prev => {
      const newSteps = [...prev];
      const lastIdx = newSteps.findIndex(s => s.type === 'last');
      newSteps.splice(lastIdx, 0, { id: uuidv4(), type: 'middle', prompt: '', status: 'idle', textSide: 'none' });
      return newSteps;
    });
  };

  const handleGenerateTitle = async (id: string) => {
    setIsSuggestingTitle(true);
    try {
      const gemini = getGemini();
      const suggested = await gemini.suggestTitle(steps.map(s => s.prompt));
      setSteps(prev => prev.map(s => s.id === id ? { ...s, bookTitle: suggested } : s));
    } catch (e) {
      console.error("Title suggestion failed", e);
    } finally {
      setIsSuggestingTitle(false);
    }
  };

  const addRule = () => setRules(prev => [...prev, { id: uuidv4(), text: '' }]);
  const updateRule = (id: string, text: string) => setRules(prev => prev.map(r => r.id === id ? { ...r, text } : r));
  const removeRule = (id: string) => setRules(prev => prev.filter(r => r.id !== id));

  const handleBulkDistribute = () => {
    if (!bulkText.trim()) return;
    const sections = bulkText.split(/(?=Spread \d+|COVER|First Page|Last Page)/gi);
    setSteps(prev => {
      const newSteps = [...prev];
      sections.forEach(section => {
        const lowerSection = section.toLowerCase().trim();
        const content = section.replace(/^(Spread \d+\s*\(SCENE\):|COVER|First Page|Last Page)/i, '').trim();
        if (lowerSection.startsWith('cover')) {
          const idx = newSteps.findIndex(s => s.type === 'cover');
          if (idx !== -1) newSteps[idx] = { ...newSteps[idx], prompt: content };
        } else if (lowerSection.startsWith('first page')) {
          const idx = newSteps.findIndex(s => s.type === 'first');
          if (idx !== -1) newSteps[idx] = { ...newSteps[idx], prompt: content };
        } else if (lowerSection.startsWith('last page')) {
          const idx = newSteps.findIndex(s => s.type === 'last');
          if (idx !== -1) newSteps[idx] = { ...newSteps[idx], prompt: content };
        } else if (lowerSection.startsWith('spread')) {
          const match = lowerSection.match(/spread (\d+)/);
          if (match) {
            const spreadNum = parseInt(match[1]);
            const targetIdx = spreadNum + 1; 
            if (targetIdx < newSteps.length - 1) newSteps[targetIdx] = { ...newSteps[targetIdx], prompt: content };
          }
        }
      });
      return newSteps;
    });
    setShowBulkImport(false);
  };

  const executeCurrentStep = async (index: number) => {
    if (!hasKey) await handleSelectKey();
    const step = steps[index];
    setSteps(prev => prev.map((s, idx) => idx === index ? { ...s, status: 'generating' } : s));
    
    try {
      const gemini = getGemini();
      const ruleTexts = rules.map(r => r.text).filter(t => t.trim().length > 0);
      const previousImage = index > 0 ? steps[index-1].generatedImageUrl : undefined;

      const imageUrl = await gemini.generateStepImage(
        {
          prompt: step.prompt,
          type: step.type,
          textSide: step.textSide,
          bookTitle: step.bookTitle,
          cast: step.cast,
          showText: step.showText
        },
        ruleTexts,
        config,
        previousImage,
        characterRef || undefined
      );

      setSteps(prev => prev.map((s, idx) => idx === index ? { 
        ...s, 
        status: 'completed', 
        generatedImageUrl: imageUrl 
      } : s));
      setAwaitingApproval(true);
    } catch (err: any) {
      setSteps(prev => prev.map((s, idx) => idx === index ? { ...s, status: 'error', error: err.message } : s));
      if (err.message?.includes("Key configuration")) setHasKey(false);
      setIsProcessActive(false);
    }
  };

  const startNarrativeFlow = async () => {
    const queue = steps.map((s, i) => (s.prompt.trim() || s.type === 'cover') ? i : -1).filter(i => i !== -1);
    if (queue.length === 0) return;
    setIsProcessActive(true);
    setCurrentQueueIndex(0);
    setAwaitingApproval(false);
    await executeCurrentStep(queue[0]);
  };

  const handleApproval = async () => {
    const queue = steps.map((s, i) => (s.prompt.trim() || s.type === 'cover') ? i : -1).filter(i => i !== -1);
    const nextQueueIdx = currentQueueIndex + 1;
    if (nextQueueIdx < queue.length) {
      setCurrentQueueIndex(nextQueueIdx);
      setAwaitingApproval(false);
      await executeCurrentStep(queue[nextQueueIdx]);
    } else {
      setIsProcessActive(false);
      setCurrentQueueIndex(-1);
      setAwaitingApproval(false);
    }
  };

  const handleRedo = async () => {
    const queue = steps.map((s, i) => (s.prompt.trim() || s.type === 'cover') ? i : -1).filter(i => i !== -1);
    setAwaitingApproval(false);
    await executeCurrentStep(queue[currentQueueIndex]);
  };

  const downloadAll = () => {
    steps.forEach((step, idx) => {
      if (step.generatedImageUrl) {
        const link = document.createElement('a');
        link.href = step.generatedImageUrl;
        link.download = `story-${step.type}-${idx}.png`;
        link.click();
      }
    });
  };

  const currentStep = currentQueueIndex >= 0 ? steps[steps.map((s, i) => (s.prompt.trim() || s.type === 'cover') ? i : -1).filter(i => i !== -1)[currentQueueIndex]] : null;

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-8 max-w-7xl mx-auto">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="white">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-500 uppercase">
              Nano Canvas Pro
            </h1>
            <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.3em]">Sequential Narrative Designer</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {!hasKey && (
            <button
              onClick={handleSelectKey}
              className="px-6 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold transition-all border border-amber-500/50 text-xs uppercase tracking-widest shadow-lg shadow-amber-600/20"
            >
              Select Paid API Key
            </button>
          )}
          {steps.some(s => s.generatedImageUrl) && !isProcessActive && (
            <button
              onClick={downloadAll}
              className="px-6 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-bold transition-all border border-gray-800 text-xs uppercase tracking-widest"
            >
              Download All
            </button>
          )}
          <button
            onClick={startNarrativeFlow}
            disabled={isProcessActive || steps.every(s => !s.prompt.trim())}
            className={`px-8 py-2.5 rounded-xl font-black tracking-widest uppercase text-xs transition-all flex items-center gap-2 ${
              isProcessActive 
                ? 'bg-blue-900/50 cursor-not-allowed text-white/50' 
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-xl shadow-blue-500/20 active:scale-95'
            }`}
          >
            {isProcessActive ? 'Rendering Sequence...' : 'Begin Rendering'}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-4 flex flex-col gap-6">
          <section className="glass-panel p-5 rounded-2xl border-l-4 border-l-blue-500">
             <div className="flex items-center justify-between mb-4">
              <h2 className="text-[10px] font-black text-gray-100 uppercase tracking-widest">Global Output Settings</h2>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-gray-500 uppercase">Resolution</label>
                <div className="grid grid-cols-3 gap-1">
                  {(["1K", "2K", "4K"] as ImageSize[]).map(size => (
                    <button
                      key={size}
                      disabled={isProcessActive}
                      onClick={() => setConfig(prev => ({...prev, imageSize: size}))}
                      className={`py-1 text-[10px] font-bold rounded-lg border transition-all ${
                        config.imageSize === size 
                          ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20' 
                          : 'bg-gray-900 border-gray-800 text-gray-500 hover:border-gray-700'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-gray-500 uppercase">Aspect Ratio</label>
                <div className="grid grid-cols-3 gap-1">
                  {(["16:9", "4:3", "1:1", "3:4", "9:16"] as AspectRatio[]).map(ratio => (
                    <button
                      key={ratio}
                      disabled={isProcessActive}
                      onClick={() => setConfig(prev => ({...prev, aspectRatio: ratio}))}
                      className={`py-1 text-[10px] font-bold rounded-lg border transition-all ${
                        config.aspectRatio === ratio 
                          ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-600/20' 
                          : 'bg-gray-900 border-gray-800 text-gray-500 hover:border-gray-700'
                      }`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[9px] font-black text-gray-500 uppercase">Bleed Area (Margin)</label>
                  <span className="text-[9px] font-black text-blue-400">{config.bleedPercent}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="20"
                  step="1"
                  value={config.bleedPercent}
                  disabled={isProcessActive}
                  onChange={(e) => setConfig(prev => ({...prev, bleedPercent: parseInt(e.target.value)}))}
                  className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              <div className="pt-2 border-t border-white/5 mt-4">
                <div className="flex items-center justify-between group cursor-pointer" onClick={() => setConfig(prev => ({...prev, demographicExclusion: !prev.demographicExclusion}))}>
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest cursor-pointer group-hover:text-white transition-colors">Black Away (Exclusion)</label>
                  <div className={`w-8 h-4 rounded-full p-0.5 transition-all ${config.demographicExclusion ? 'bg-blue-600' : 'bg-gray-800'}`}>
                    <div className={`w-3 h-3 bg-white rounded-full transition-transform ${config.demographicExclusion ? 'translate-x-4' : 'translate-x-0'}`} />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="glass-panel p-5 rounded-2xl border-l-4 border-l-orange-500">
            <h2 className="text-[10px] font-black text-gray-100 uppercase tracking-widest mb-4 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse"></div>
              Hero Reference
            </h2>
            <div className="relative group cursor-pointer border-2 border-dashed border-white/5 rounded-xl p-3 hover:border-orange-500/30 transition-all">
              <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" onChange={handleCharacterUpload} disabled={isProcessActive} />
              {characterRef ? (
                <div className="relative aspect-video rounded-lg overflow-hidden shadow-2xl">
                  <img src={characterRef} alt="Hero Ref" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <span className="text-[10px] font-black text-white uppercase text-center px-2">Replace Character</span>
                  </div>
                </div>
              ) : (
                <div className="py-6 text-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 mx-auto mb-2 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  <div className="text-[10px] text-gray-500 font-black uppercase">Add Character Photo</div>
                </div>
              )}
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

        <div className="lg:col-span-8">
          <section className="glass-panel rounded-3xl p-6 min-h-[700px] sticky top-8 border-white/5 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between mb-8 h-12">
              <h2 className="text-xl font-black text-white flex items-center gap-3 uppercase tracking-tighter">
                Creative Canvas
                {isProcessActive && (
                   <span className="flex items-center gap-2 text-[10px] font-black text-blue-500 bg-blue-500/10 px-3 py-1 rounded-full uppercase tracking-widest border border-blue-500/20 animate-pulse">
                     Step {currentQueueIndex + 1}
                   </span>
                )}
              </h2>
              
              {awaitingApproval && (
                <div className="flex items-center gap-3 animate-in fade-in slide-in-from-right-4 duration-500">
                  <button 
                    onClick={handleRedo}
                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-[10px] font-black rounded-xl uppercase tracking-widest transition-all"
                  >
                    Redo Spread
                  </button>
                  <button 
                    onClick={handleApproval}
                    className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black rounded-xl uppercase tracking-widest shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2"
                  >
                    <span>Approve Spread</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                  </button>
                </div>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto pr-4 pb-20 custom-scrollbar">
              {!steps.some(s => s.generatedImageUrl || s.status === 'generating') ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-30">
                  <div className="w-24 h-24 border-2 border-dashed border-white/10 rounded-full flex items-center justify-center mb-6">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="gray"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  </div>
                  <h3 className="text-sm font-black uppercase tracking-[0.4em] text-gray-400">Waiting for Render</h3>
                  <p className="text-[10px] text-gray-500 max-w-xs mt-4 font-bold uppercase leading-relaxed">Setup your story sequence and click "Begin Rendering" to start the interactive session.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-12">
                  {isProcessActive && currentStep && (
                    <div className="border-2 border-blue-500/30 rounded-[2.5rem] p-4 bg-blue-500/5 relative">
                       <h3 className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-4 ml-4">Current Review</h3>
                       <div className="relative aspect-video rounded-3xl overflow-hidden bg-gray-950 shadow-2xl ring-2 ring-blue-500/40" style={{ aspectRatio: config.aspectRatio.replace(':', '/') }}>
                          {currentStep.status === 'generating' && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/90 backdrop-blur-xl z-20">
                              <div className="relative w-20 h-20 mb-10">
                                <div className="absolute inset-0 border-8 border-blue-500/10 rounded-full"></div>
                                <div className="absolute inset-0 border-8 border-t-blue-500 rounded-full animate-spin"></div>
                              </div>
                              <span className="text-xs font-black text-blue-500 uppercase tracking-[0.5em] animate-pulse">Rendering {currentStep.type}...</span>
                            </div>
                          )}
                          {currentStep.generatedImageUrl && (
                            <>
                              <img src={currentStep.generatedImageUrl} alt="Current Preview" className="w-full h-full object-cover" />
                              
                              {/* Natural Atmosphere Shadow - Ultra-Soft Gradient */}
                              {currentStep.type !== 'cover' && currentStep.textSide !== 'none' && (
                                <div className={`absolute top-0 bottom-0 w-[80%] pointer-events-none transition-all duration-1000 ease-in-out ${
                                  currentStep.textSide === 'left' 
                                    ? 'left-0 bg-gradient-to-r from-black/95 via-black/70 via-black/20 to-transparent' 
                                    : 'right-0 bg-gradient-to-l from-black/95 via-black/70 via-black/20 to-transparent'
                                }`} />
                              )}

                              <div className="absolute bottom-6 right-6 flex gap-2">
                                <a 
                                  href={currentStep.generatedImageUrl} 
                                  download={`draft-${currentStep.type}.png`}
                                  className="bg-white/90 hover:bg-white text-black text-[10px] font-black px-5 py-2.5 rounded-xl uppercase tracking-widest shadow-2xl transition-all flex items-center gap-2"
                                >
                                  <span>Download Draft</span>
                                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                </a>
                              </div>
                            </>
                          )}
                          <div className="absolute top-6 left-6 z-10">
                            <div className="bg-black/60 backdrop-blur-2xl px-5 py-2 rounded-full border border-white/10 flex items-center gap-3">
                               <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                               <span className="text-xs font-black text-white uppercase tracking-widest">{currentStep.type === 'middle' ? `Active Spread` : currentStep.type}</span>
                            </div>
                          </div>
                       </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mt-4">
                    {steps.map((step, idx) => (
                      (step.generatedImageUrl || step.status === 'error') && (!isProcessActive || steps.map((s, i) => (s.prompt.trim() || s.type === 'cover') ? i : -1).filter(i => i !== -1)[currentQueueIndex] !== idx) && (
                        <div key={step.id} className={`group relative aspect-video rounded-3xl overflow-hidden bg-gray-950 border border-white/5 shadow-2xl transition-all hover:ring-2 hover:ring-blue-500/50 ${
                          step.type === 'cover' ? 'xl:col-span-2 border-amber-500/30' : ''
                        }`} style={{ aspectRatio: config.aspectRatio.replace(':', '/') }}>
                          <img src={step.generatedImageUrl} alt={step.type} className="w-full h-full object-cover" />
                          
                          {/* Natural Atmosphere Shadow - Ultra-Soft Gradient */}
                          {step.type !== 'cover' && step.textSide !== 'none' && (
                            <div className={`absolute top-0 bottom-0 w-[80%] pointer-events-none transition-all duration-1000 ease-in-out ${
                              step.textSide === 'left' 
                                ? 'left-0 bg-gradient-to-r from-black/95 via-black/70 via-black/20 to-transparent' 
                                : 'right-0 bg-gradient-to-l from-black/95 via-black/70 via-black/20 to-transparent'
                            }`} />
                          )}

                          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-500 p-8 flex flex-col justify-end">
                            <div className="flex items-center gap-4 mb-3">
                               <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-tighter ${
                                 step.type === 'cover' ? 'bg-amber-500 text-black' : 'bg-blue-500/20 text-blue-400'
                               }`}>{step.type}</span>
                               {step.bookTitle && <h4 className="text-white font-black text-lg drop-shadow-lg">{step.bookTitle}</h4>}
                            </div>
                            <p className="text-[11px] text-gray-400 line-clamp-2 italic font-medium leading-relaxed mb-6 border-l-2 border-white/10 pl-4">"{step.prompt}"</p>
                            <div className="grid grid-cols-2 gap-3">
                              <a 
                                href={step.generatedImageUrl} 
                                download={`render-${step.type}-${idx}.png`}
                                className="bg-white text-black text-[10px] font-black py-3 rounded-2xl text-center uppercase tracking-[0.2em] transition-all hover:bg-gray-100 active:scale-95 flex items-center justify-center gap-2 shadow-xl shadow-black/50"
                              >
                                <span>Download</span>
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                              </a>
                              <button 
                                onClick={() => window.open(step.generatedImageUrl, '_blank')}
                                className="bg-white/10 backdrop-blur-xl border border-white/10 text-white text-[10px] font-black py-3 rounded-2xl uppercase tracking-[0.2em] hover:bg-white/20 transition-all"
                              >
                                Full Screen
                              </button>
                            </div>
                          </div>
                          
                          <div className="absolute top-6 left-6 z-10">
                            <div className="bg-black/60 backdrop-blur-2xl px-4 py-1.5 rounded-full border border-white/10 flex items-center gap-3">
                               <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                               <span className="text-[10px] font-black text-white uppercase tracking-widest">
                                 {step.type === 'middle' ? `Spread ${idx - 1}` : step.type}
                               </span>
                            </div>
                          </div>
                        </div>
                      )
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default App;