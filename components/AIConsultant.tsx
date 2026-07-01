
import React from 'react';
import { Sparkles } from 'lucide-react';
import { Order, Item } from '../types';

interface AIConsultantProps {
  orders: Order[];
  items?: Item[];
}

const AIConsultant: React.FC<AIConsultantProps> = () => {
  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
      <div className="flex flex-col items-center justify-center py-32 bg-white rounded-3xl border-2 border-dashed border-slate-200">
        <Sparkles className="text-slate-200 mb-4" size={48} />
        <p className="text-slate-400 font-bold">준비 중입니다</p>
      </div>
    </div>
  );
};

export default AIConsultant;
