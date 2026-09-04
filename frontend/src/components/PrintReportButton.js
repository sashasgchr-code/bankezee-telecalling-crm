import React from 'react';
import { Printer } from 'lucide-react';

/** Print / Save as PDF for a report block. Adds the print-only header, then window.print(). */
export const PrintReportButton = ({ title, subtitle, targetId, testId = 'print-report-btn' }) => {
  const handlePrint = () => {
    const node = targetId ? document.getElementById(targetId) : null;
    if (node) {
      node.classList.add('print-area');
      const root = node.closest('.print-root') || node.parentElement;
      if (root) root.classList.add('print-root');
    }
    document.body.classList.add('printing-report');
    const cleanup = () => {
      document.body.classList.remove('printing-report');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => window.print(), 50);
  };

  return (
    <>
      <button
        onClick={handlePrint}
        className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 flex items-center gap-2 print-hide"
        data-testid={testId}
      >
        <Printer size={15} />
        Print / PDF
      </button>
      <div className="print-header">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
        <p>Generated {new Date().toLocaleString('en-IN')}</p>
      </div>
    </>
  );
};

export default PrintReportButton;
