import React, { memo } from 'react';
import CachedImg from '@/components/CachedImg';
import { Edit, Trash2, Eye, EyeOff, Loader2 } from 'lucide-react';

interface MemoizedAdminCardProps {
  item: any;
  glassCard: string;
  onEdit: () => void;
  onDelete: () => void;
  onToggleVisibility: (id: string, current: boolean) => void;
  isVisibilityBusy: string | null;
}

const MemoizedAdminCard = ({
  item,
  glassCard,
  onEdit,
  onDelete,
  onToggleVisibility,
  isVisibilityBusy
}: MemoizedAdminCardProps) => {
  return (
    <div className={`${glassCard} group relative overflow-hidden flex flex-col h-full transition-all hover:scale-[1.02] hover:shadow-xl hover:shadow-indigo-500/10`}>
      <div className="aspect-[2/3] relative overflow-hidden cursor-pointer bg-zinc-900" onClick={onEdit}>
        <CachedImg 
          src={item.poster} 
          alt={item.title} 
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
          <button className="w-full py-2 bg-indigo-600/90 text-white text-[11px] font-bold rounded-lg backdrop-blur-sm">
            EDIT SERIES
          </button>
        </div>
        {item.rating && (
          <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded text-[10px] font-bold text-amber-400 border border-amber-400/20">
            ★ {item.rating}
          </div>
        )}
      </div>
      
      <div className="p-3 flex flex-col flex-1">
        <h4 className="text-[12px] font-bold line-clamp-2 mb-1 group-hover:text-indigo-400 transition-colors leading-snug h-8">
          {item.title}
        </h4>
        <p className="text-[10px] text-zinc-500 mb-3 truncate">
          {item.category || 'No Category'}
        </p>
        
        <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/5">
          <button 
            onClick={() => onToggleVisibility(item.id, item.hidden !== true)}
            className={`p-1.5 rounded-md transition-colors ${item.hidden ? 'text-zinc-500 hover:text-white' : 'text-emerald-500 hover:text-emerald-400'}`}
          >
            {isVisibilityBusy === item.id ? (
              <Loader2 size={14} className="animate-spin" />
            ) : item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          
          <div className="flex gap-1">
            <button onClick={onEdit} className="p-1.5 text-blue-400 hover:bg-blue-500/10 rounded-md transition-colors">
              <Edit size={14} />
            </button>
            <button onClick={onDelete} className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors">
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default memo(MemoizedAdminCard);