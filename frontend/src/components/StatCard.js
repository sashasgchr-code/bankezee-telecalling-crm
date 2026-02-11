import React from 'react';
import { Colors } from '../constants/colors';

const StatCard = ({ title, value, icon: Icon, color = Colors.primary }) => {
  return (
    <div className="card p-4 flex-1 min-w-0" data-testid={`stat-card-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <div 
        className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-2"
        style={{ backgroundColor: `${color}20` }}
      >
        {Icon && <Icon size={24} style={{ color }} />}
      </div>
      <p className="text-2xl font-bold text-gray-900 text-center">{value}</p>
      <p className="text-xs text-gray-500 text-center mt-1">{title}</p>
    </div>
  );
};

export default StatCard;
