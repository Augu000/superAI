
import React, { useState } from 'react';
import { ImageStep } from '../types';

interface StepInputProps {
  step: ImageStep;
  index: number;
  onUpdate: (id: string, updates: Partial<ImageStep>) => void;
  onDelete?: (id: string) => void;
  onGenerateTitle?: (id: string) => void;
  disabled?: boolean;
  isSuggestingTitle?: boolean;
}

const StepInput: React.FC<StepInputProps> = ({ step, index, onUpdate, onDelete, onGenerateTitle, disabled, isSuggestingTitle }) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    if (onDelete) {
      onDelete(step.id);
    }
    setShowDeleteConfirm(false);
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
  };
  const getTagStyles = () => {
    switch(step.type) {
      case 'cover': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      case 'first': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 'last': return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
      default: return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
    }
  };

  const getLabel = () => {
    if (step.type === 'cover') return 'Book Cover';
    if (step.type === 'first') return 'Intro Page';
    if (step.type === 'last') return 'Closing Page';
    return `Spread ${index - 1}`;
  };

  return (
    <div className={`relative flex gap-4 group transition-all ${disabled && !isSuggestingTitle ? 'opacity-50 grayscale' : ''}`}>
      {/* Timeline Indicator */}
      <div className="flex flex-col items-center">
        <div className={`w-3 h-3 rounded-full border-2 border-slate-800 ${step.status === 'completed' ? 'bg-emerald-500' : 'bg-slate-700'}`} />
        <div className="flex-1 w-0.5 bg-slate-800/50 mt-2 mb-2" />
      </div>

      <div className={`flex-1 glass-card rounded-2xl p-4 mb-4 ${step.status === 'generating' ? 'ring-2 ring-blue-500/50' : ''}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
             <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border ${getTagStyles()}`}>
              {getLabel()}
            </span>
            {step.status === 'completed' && (
              <svg className="w-3 h-3 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
            )}
          </div>

          <div className="flex items-center gap-3">
            {step.type !== 'cover' && (
              <div className="flex items-center gap-1 bg-slate-950/50 rounded-lg p-0.5 border border-white/5">
                {(['none', 'left', 'right'] as const).map(side => (
                  <button
                    key={side}
                    onClick={() => onUpdate(step.id, { textSide: side })}
                    className={`text-[8px] px-1.5 py-0.5 rounded font-black uppercase tracking-tighter transition-all ${step.textSide === side ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    {side}
                  </button>
                ))}
              </div>
            )}
            
            {step.type === 'cover' && (
              <button 
                onClick={() => onUpdate(step.id, { showText: !step.showText })}
                className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-md border transition-all ${step.showText ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
              >
                {step.showText ? 'Text On' : 'Text Off'}
              </button>
            )}

            {step.type === 'middle' && onDelete && (
              <button onClick={handleDeleteClick} className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-600 hover:text-rose-500 transition-all opacity-0 group-hover:opacity-100">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            )}
          </div>
        </div>

        {(step.type === 'cover' || step.type === 'first' || step.type === 'last') && (
          <div className={`grid grid-cols-2 gap-2 mb-3 transition-opacity ${step.type === 'cover' && !step.showText ? 'opacity-20 pointer-events-none' : ''}`}>
            <div className="relative">
              <input 
                value={step.bookTitle || ''} 
                onChange={e => onUpdate(step.id, { bookTitle: e.target.value })}
                placeholder="Story Title"
                className="w-full bg-slate-900/50 border border-white/5 rounded-lg px-2 py-1.5 text-[10px] text-white focus:border-blue-500/50 outline-none"
              />
              {step.type === 'cover' && onGenerateTitle && (
                <button 
                  onClick={() => onGenerateTitle(step.id)} 
                  disabled={isSuggestingTitle}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-amber-500/50 hover:text-amber-500 disabled:opacity-50"
                >
                  {isSuggestingTitle ? (
                    <div className="w-3 h-3 border border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1a1 1 0 112 0v1a1 1 0 11-2 0zM13.657 15.657a1 1 0 001.414-1.414l-.707-.707a1 1 0 10-1.414 1.414l.707.707zM16 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1z" /></svg>
                  )}
                </button>
              )}
            </div>
            <input 
              value={step.cast || ''} 
              onChange={e => onUpdate(step.id, { cast: e.target.value })}
              placeholder="Hero Name"
              className="w-full bg-slate-900/50 border border-white/5 rounded-lg px-2 py-1.5 text-[10px] text-white focus:border-blue-500/50 outline-none"
            />
          </div>
        )}

        <textarea 
          value={step.prompt} 
          onChange={e => onUpdate(step.id, { prompt: e.target.value })}
          placeholder="Enter visual description..."
          className="w-full bg-transparent border-none focus:ring-0 text-xs text-slate-300 placeholder-slate-600 resize-none min-h-[40px] custom-scrollbar"
        />
      </div>

      {/* Delete Confirmation Popup */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass-panel rounded-2xl p-6 max-w-md w-full mx-4 border border-white/10">
            <h3 className="text-sm font-black text-white uppercase tracking-widest mb-4">
              Confirm Deletion
            </h3>
            <p className="text-xs text-slate-300 mb-6">
              Do you really want to delete this spread? This action cannot be undone.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleConfirmDelete}
                className="flex-1 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-black text-[10px] uppercase tracking-widest transition-all"
              >
                Delete
              </button>
              <button
                onClick={handleCancelDelete}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-black text-[10px] uppercase tracking-widest transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StepInput;
