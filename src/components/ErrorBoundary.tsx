import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || 'Unexpected rendering error' };
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-white/10 dark:bg-[#16314D]">
          <AlertTriangle className="mb-3 h-8 w-8 text-amber-500" aria-hidden="true" />
          <h2 className="font-display text-lg font-semibold text-[#0F2238] dark:text-white">
            This view encountered a rendering error
          </h2>
          <p className="mt-2 max-w-md text-sm text-slate-600 dark:text-slate-300">
            {this.state.message}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, message: '' })}
            className="mt-5 inline-flex items-center gap-2 rounded-lg brand-gradient px-4 py-2 text-sm font-medium text-[#0F2238] transition-opacity hover:opacity-90"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Retry View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
