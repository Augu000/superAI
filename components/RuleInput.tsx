
import React from 'react';
import { GlobalRule } from '../types';

interface RuleInputProps {
  rule: GlobalRule;
  onUpdate: (id: string, text: string) => void;
  onRemove: (id: string) => void;
}

const RuleInput: React.FC<RuleInputProps> = ({ rule, onUpdate, onRemove }) => {
  return (
    <div className="flex items-center gap-2 bg-gray-800/50 p-2 rounded-lg border border-gray-700 focus-within:border-blue-500 transition-colors">
      <input
        type="text"
        value={rule.text}
        onChange={(e) => onUpdate(rule.id, e.target.value)}
        placeholder="e.g. 'Cyberpunk aesthetic' or '4k high detail'"
        className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-gray-200 placeholder-gray-500"
      />
      <button
        onClick={() => onRemove(rule.id)}
        className="p-1 hover:text-red-400 text-gray-500 transition-colors"
        title="Remove rule"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

export default RuleInput;
