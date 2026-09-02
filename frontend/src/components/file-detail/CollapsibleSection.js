import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * CollapsibleSection - Mobile-friendly collapsible card wrapper
 * 
 * On mobile (< 768px): Sections are collapsed by default, tap header to expand
 * On desktop (>= 768px): Sections are always expanded
 */
const CollapsibleSection = ({ 
  title, 
  subtitle, 
  icon: Icon,
  children, 
  defaultExpanded = false,
  rightContent,
  badge,
  testId,
  className = ''
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div 
      className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden ${className}`}
      data-testid={testId}
    >
      {/* Header - Clickable on mobile */}
      <div 
        className="px-4 sm:px-6 py-4 border-b border-gray-100 flex items-center justify-between cursor-pointer md:cursor-default"
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {Icon && (
            <div className="flex-shrink-0 w-8 h-8 bg-green-50 rounded-lg flex items-center justify-center">
              <Icon size={18} className="text-green-600" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 truncate">{title}</h3>
              {badge}
            </div>
            {subtitle && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">{subtitle}</p>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Right content (edit buttons, etc) - hidden on mobile when collapsed */}
          <div className={`hidden sm:flex items-center gap-2 ${!isExpanded ? 'md:flex' : ''}`}>
            {rightContent}
          </div>
          
          {/* Collapse indicator - only on mobile */}
          <button 
            className="md:hidden p-1 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label={isExpanded ? 'Collapse section' : 'Expand section'}
          >
            {isExpanded ? (
              <ChevronUp size={20} className="text-gray-400" />
            ) : (
              <ChevronDown size={20} className="text-gray-400" />
            )}
          </button>
        </div>
      </div>
      
      {/* Content - Collapsible on mobile, always visible on desktop */}
      <div 
        className={`
          transition-all duration-200 ease-in-out
          ${isExpanded ? 'max-h-[5000px] opacity-100' : 'max-h-0 opacity-0 md:max-h-none md:opacity-100'}
          overflow-hidden md:overflow-visible
        `}
      >
        <div className="p-4 sm:p-6">
          {/* Show right content inside on mobile when expanded */}
          {rightContent && (
            <div className="sm:hidden flex justify-end mb-4">
              {rightContent}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
};

export default CollapsibleSection;
