import React from 'react';
import { Loader2 } from 'lucide-react';

const LoadingScreen = () => {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center" data-testid="loading-screen">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-green-600">BANKEZEE</h1>
        <p className="text-gray-600 -mt-1">Connect</p>
      </div>
      <Loader2 className="w-8 h-8 text-green-600 animate-spin mt-8" />
    </div>
  );
};

export default LoadingScreen;
