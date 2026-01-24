import React from 'react';
import { ImageStep } from '../types';

interface StepInputProps {
  step: ImageStep;
  index: number;
  onUpdate: (id: string, updates: Partial<ImageStep>) => void;
  onDelete?: (id: string) => void;
  onGenerateTitle?: (id: string) => void;
  disabled?: boolean;
}

const StepInput: React.FC<StepInputProps> = ({ step, index, onUpdate, onDelete, onGenerateTitle, disabled }) => {
  const getLabel = () => {
    switch(step.type) {
      case 'cover': return 'Book Cover';
      case 'first': return 'First Page';
      case 'last': return 'Last Page';
      default: return `Story Spread ${index - 1}`;
    }
  };

  const getThemeColor = () => {
    switch(step.type) {
      case 'cover': return 'text-amber-400';
      case 'first': return 'text-emerald-400';
      case 'last': return 'text-rose-400';
      default: return 'text-blue-400';
    }
  };

  return (
    <div className={`flex flex-col gap-3 p-4 rounded-xl glass-panel group transition-all border border-transparent ${
      step.status === 'generating' ? 'border-blue-500/50 animate-pulse' : 'hover:border-white/10'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-black uppercase tracking-widest ${getThemeColor()}`}>
            {getLabel()}
          </span>
          {step.type === 'middle' && onDelete && !disabled && (
            <button
              onClick={() => onDelete(step.id)}
              className="p-1 text-gray-600 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
              title="Delete Spread"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
        
        {step.type === 'cover' ? (
           <div className="flex items-center gap-2">
             <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">Text Overlay</span>
             <button
               disabled={disabled}
               onClick={() => onUpdate(step.id, { showText: !step.showText })}
               className={`w-7 h-4 rounded-full p-0.5 transition-all ${step.showText ? 'bg-amber-600' : 'bg-gray-800'}`}
             >
               <div className={`w-3 h-3 bg-white rounded-full transition-transform ${step.showText ? 'translate-x-3' : 'translate-x-0'}`} />
             </button>
           </div>
        ) : (
          <div className="flex items-center bg-gray-950 rounded-lg p-0.5 border border-gray-800">
            {(['none', 'left', 'right'] as const).map((side) => (
              <button
                key={side}
                disabled={disabled}
                onClick={() => onUpdate(step.id, { textSide: side })}
                className={`text-[9px] px-2 py-1 rounded transition-all capitalize font-bold ${
                  step.textSide === side 
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/50' 
                    : 'text-gray-600 hover:text-gray-400'
                }`}
              >
                {side === 'none' ? 'Full' : `${side} Shadow`}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {(step.type === 'cover' || step.type === 'first' || step.type === 'last') && (
          <div className={`grid grid-cols-2 gap-2 transition-opacity ${step.type === 'cover' && !step.showText ? 'opacity-20 pointer-events-none' : ''}`}>
            <div className="relative group/input">
              <input
                type="text"
                value={step.bookTitle || ''}
                onChange={(e) => onUpdate(step.id, { bookTitle: e.target.value })}
                placeholder="Title..."
                disabled={disabled || (step.type === 'cover' && !step.showText)}
                className="w-full bg-gray-900/50 border border-gray-800 rounded-lg pl-2 pr-8 py-1.5 text-xs text-white placeholder-gray-600 focus:border-blue-500 outline-none transition-colors"
              />
              {step.type === 'cover' && onGenerateTitle && (
                <button
                  onClick={() => onGenerateTitle(step.id)}
                  disabled={disabled || !step.showText}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-amber-400 transition-colors"
                  title="Generate suggested title"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </button>
              )}
            </div>
            <input
              type="text"
              value={step.cast || ''}
              onChange={(e) => onUpdate(step.id, { cast: e.target.value })}
              placeholder="Starring..."
              disabled={disabled || (step.type === 'cover' && !step.showText)}
              className="bg-gray-900/50 border border-gray-800 rounded-lg px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-blue-500 outline-none transition-colors"
            />
          </div>
        )}

        <textarea
          value={step.prompt}
          onChange={(e) => onUpdate(step.id, { prompt: e.target.value })}
          disabled={disabled}
          placeholder={step.type === 'cover' ? "Describe the cover atmosphere..." : `Describe ${getLabel().toLowerCase()}...`}
          className="w-full bg-transparent border-none focus:ring-0 text-gray-200 resize-none placeholder-gray-600 text-sm min-h-[60px] custom-scrollbar"
        />
      </div>
      
      <div className="flex items-center justify-between mt-1 pt-2 border-t border-white/5">
        <div className="flex gap-2">
          {step.status === 'completed' && <span className="text-[9px] font-black text-emerald-400 uppercase tracking-tighter">Rendered</span>}
          {step.status === 'error' && <span className="text-[9px] font-black text-rose-500 uppercase tracking-tighter">Error</span>}
        </div>
        {step.type === 'cover' && (
          <span className="text-[8px] text-gray-500 font-bold uppercase italic tracking-widest">Seamless Full Canvas</span>
        )}
      </div>
    </div>
  );
};

export default StepInput;