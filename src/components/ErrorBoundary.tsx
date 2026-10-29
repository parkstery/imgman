import * as React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  generation: number;
}

// React 19 in this project has no @types/react class Component construct signature.
const ComponentBase: any = (React as any).Component;

/**
 * Last-resort recovery. Retry remounts children; document state is restored
 * from the in-memory session cache rather than wiped.
 */
export class ErrorBoundary extends ComponentBase {
  state: ErrorBoundaryState = { error: null, generation: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error('App render error:', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState((prev: ErrorBoundaryState) => ({
      error: null,
      generation: prev.generation + 1,
    }));
  };

  render() {
    const { error, generation } = this.state as ErrorBoundaryState;
    const { children } = this.props as ErrorBoundaryProps;
    if (error) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-stone-950 text-stone-100 p-6">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="app-error-title"
            className="max-w-md w-full rounded-xl border border-stone-700 bg-stone-900 p-6 shadow-2xl space-y-3"
          >
            <h1 id="app-error-title" className="text-base font-semibold text-stone-100">
              예기치 않은 오류가 발생했습니다
            </h1>
            <p className="text-xs text-stone-400 leading-relaxed">
              현재 문서는 메모리에 남아 있습니다. 화면을 다시 그리면 마지막 편집 상태로
              복구를 시도합니다. 문서를 지우거나 자동으로 비우지 않습니다.
            </p>
            <pre className="text-[11px] text-rose-300 bg-stone-950/80 border border-stone-800 rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap">
              {error.message}
            </pre>
            <button
              type="button"
              onClick={this.handleRetry}
              className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
            >
              화면 복구
            </button>
          </div>
        </div>
      );
    }

    return <React.Fragment key={generation}>{children}</React.Fragment>;
  }
}
