import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

declare global {
    interface Window {
        MonacoEnvironment?: {
            getWorker: (_moduleId: string, label: string) => Worker
        }
    }
}

window.MonacoEnvironment = {
    getWorker(_moduleId: string, label: string) {
        switch (label) {
            case 'json':
                return new jsonWorker()
            case 'css':
            case 'scss':
            case 'less':
                return new cssWorker()
            case 'html':
            case 'handlebars':
            case 'razor':
                return new htmlWorker()
            case 'typescript':
            case 'javascript':
                return new tsWorker()
            default:
                return new editorWorker()
        }
    },
}

const rootElement = document.getElementById('root')
if (!rootElement) {
    throw new Error('Root element not found')
}

ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
