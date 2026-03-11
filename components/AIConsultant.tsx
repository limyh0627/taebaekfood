
import React from 'react';
import { Sparkles } from 'lucide-react';
import { Order, Product } from '../types';

interface AIConsultantProps {
  orders: Order[];
  products: Product[];
}

const AIConsultant: React.FC<AIConsultantProps> = () => {
  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
      <div>
        <h2 className="text-3xl font-black text-slate-900 uppercase">AI 인사이트</h2>
        <p className="text-slate-500 text-sm font-medium">AI 기반 비즈니스 분석 기능입니다.</p>
      </div>
      <div className="flex flex-col items-center justify-center py-32 bg-white rounded-3xl border-2 border-dashed border-slate-200">
        <Sparkles className="text-slate-200 mb-4" size={48} />
        <p className="text-slate-400 font-bold">준비 중입니다</p>
      </div>
    </div>
  );
};

export default AIConsultant;
