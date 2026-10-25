import React from 'react';

export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        console.error('UI error caught by boundary', error, info);
    }

    render() {
        if (!this.state.error) return this.props.children;
        if (this.props.inline) {
            return (
                <div className="p-3 text-xs font-mono text-red-400 border border-red-900/50 rounded bg-red-900/10">
                    {this.props.label || 'Panel'} failed to render.
                    <button className="ml-2 underline" onClick={() => this.setState({ error: null })}>Retry</button>
                </div>
            );
        }
        return (
            <div className="h-screen flex flex-col items-center justify-center gap-4 bg-[#0f172a] text-slate-200 font-mono">
                <p className="text-sm text-red-400">Onyx hit an unexpected error.</p>
                <button
                    className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-xs"
                    onClick={() => window.location.reload()}
                >
                    Reload
                </button>
            </div>
        );
    }
}
