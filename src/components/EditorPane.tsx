import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react';
import { useVfs } from '../vfs/VfsContext';

// UMD-style globals the React + TypeScript template loads via CDN <script> tags
// (no npm 'react' package, no module resolution) — just enough shape for the
// classic JSX transform (React.createElement) to type-check without erroring.
const REACT_GLOBALS_LIB = `
declare const React: any;
declare const ReactDOM: any;
declare namespace JSX {
  interface IntrinsicElements { [elemName: string]: any; }
  interface ElementClass { render: any; }
  interface Element {}
}
`;

let typescriptConfigured = false;

function configureTypeScript(monaco: Parameters<BeforeMount>[0]) {
  if (typescriptConfigured) return;
  typescriptConfigured = true;

  const compilerOptions = {
    jsx: monaco.languages.typescript.JsxEmit.React,
    jsxFactory: 'React.createElement',
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    allowNonTsExtensions: true,
    allowJs: true,
    esModuleInterop: true,
  };
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions);
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions);

  monaco.languages.typescript.typescriptDefaults.addExtraLib(REACT_GLOBALS_LIB, 'sandbox:react-globals.d.ts');
  monaco.languages.typescript.javascriptDefaults.addExtraLib(REACT_GLOBALS_LIB, 'sandbox:react-globals.d.ts');

  // Real mistakes (typos, unresolved names, mismatched braces) should still be
  // caught — the extra lib above exists so semantic checks don't have to be
  // switched off just to stop React/JSX itself from looking "undefined".
  const diagnosticsOptions = { noSemanticValidation: false, noSyntaxValidation: false };
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
}

function defineTheme(monaco: Parameters<BeforeMount>[0]) {
  monaco.editor.defineTheme('sandbox-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c6ff5e' },
      { token: 'string', foreground: 'ffd166' },
      { token: 'number', foreground: '7c5cff' },
      { token: 'tag', foreground: 'ff6ec7' },
      { token: 'attribute.name', foreground: '7ee8fa' },
    ],
    colors: {
      'editor.background': '#0d0e14',
      'editor.foreground': '#e8e6f0',
      'editor.lineHighlightBackground': '#161826',
      'editorLineNumber.foreground': '#3a3d52',
      'editorLineNumber.activeForeground': '#c6ff5e',
      'editorCursor.foreground': '#c6ff5e',
      'editor.selectionBackground': '#7c5cff44',
      'editorGutter.background': '#0d0e14',
      'editorWidget.background': '#161826',
      'editorWidget.border': '#2a2d42',
    },
  });
}

function ImagePreview({ name, content }: { name: string; content: string }) {
  return (
    <div className="image-preview">
      <div className="image-preview-checker">
        <img src={content} alt={name} />
      </div>
      <div className="image-preview-caption">{name}</div>
    </div>
  );
}

export function EditorPane() {
  const vfs = useVfs();
  const activeId = vfs.activeId;
  const node = activeId ? vfs.getNode(activeId) : null;

  if (!node || node.type !== 'file') {
    return (
      <div className="editor-empty">
        <div className="editor-empty-glyph">{'</>'}</div>
        <p>Select or create a file to start editing</p>
      </div>
    );
  }

  if (node.isBinary) {
    return <ImagePreview name={node.name} content={node.content} />;
  }

  const beforeMount: BeforeMount = (monaco) => {
    configureTypeScript(monaco);
    defineTheme(monaco);
  };
  const onMount: OnMount = (editor) => {
    editor.updateOptions({ tabSize: 2 });
  };

  return (
    <div className="editor-host">
      <Editor
        key={node.id}
        path={vfs.path(node.id)}
        defaultLanguage={node.language}
        defaultValue={node.content}
        theme="sandbox-dark"
        beforeMount={beforeMount}
        onMount={onMount}
        onChange={(value) => vfs.updateFileContent(node.id, value ?? '')}
        options={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 13.5,
          fontLigatures: true,
          minimap: { enabled: true, scale: 1 },
          smoothScrolling: true,
          cursorBlinking: 'phase',
          padding: { top: 14 },
          scrollBeyondLastLine: false,
          renderLineHighlight: 'all',
          automaticLayout: true,
        }}
      />
    </div>
  );
}
