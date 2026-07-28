import type { FolderNode } from '../types';
import type { Framework } from '../types';
import { makeId } from './vfs';

export function createStaticTree(): FolderNode {
  return {
    id: 'root',
    type: 'folder',
    name: 'root',
    isOpen: true,
    children: [
      {
        id: makeId('file'),
        type: 'file',
        name: 'index.html',
        isBinary: false,
        language: 'html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>My Test Site</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main class="stage">
    <h1>Hello, Sandbox <span class="wave">👋</span></h1>
    <p>Edit <code>index.html</code>, <code>style.css</code> and <code>script.js</code> on the left,
       then hit <strong>Preview</strong> to see it render.</p>
    <button id="btn">Click me</button>
    <p id="count">Clicks: 0</p>
  </main>
  <script src="script.js"></script>
</body>
</html>
`,
      },
      {
        id: makeId('file'),
        type: 'file',
        name: 'style.css',
        isBinary: false,
        language: 'css',
        content: `:root {
  color-scheme: light dark;
  font-family: 'Segoe UI', system-ui, sans-serif;
}

body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 20% 20%, #2b1055, #0f0c29 70%);
  color: #f4f0ff;
}

.stage {
  max-width: 32rem;
  padding: 2.5rem;
  text-align: center;
}

.wave {
  display: inline-block;
  animation: wave 1.6s ease-in-out infinite;
}

@keyframes wave {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(18deg); }
}

button {
  font: inherit;
  padding: 0.6rem 1.4rem;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  background: linear-gradient(135deg, #7c5cff, #c6ff5e);
  color: #0f0c29;
  font-weight: 700;
}
`,
      },
      {
        id: makeId('file'),
        type: 'file',
        name: 'script.js',
        isBinary: false,
        language: 'javascript',
        content: `let count = 0;
const btn = document.getElementById('btn');
const label = document.getElementById('count');

btn.addEventListener('click', () => {
  count += 1;
  label.textContent = \`Clicks: \${count}\`;
});
`,
      },
    ],
  };
}

export function createReactTsTree(): FolderNode {
  const appId = makeId('file');
  return {
    id: 'root',
    type: 'folder',
    name: 'root',
    isOpen: true,
    children: [
      {
        id: makeId('file'),
        type: 'file',
        name: 'index.html',
        isBinary: false,
        language: 'html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>My React App</title>
  <link rel="stylesheet" href="src/styles.css" />
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="typescript,react" src="src/App.tsx"></script>
</body>
</html>
`,
      },
      {
        id: makeId('folder'),
        type: 'folder',
        name: 'src',
        isOpen: true,
        children: [
          {
            id: appId,
            type: 'file',
            name: 'App.tsx',
            isBinary: false,
            language: 'typescript',
            content: `function App() {
  const [count, setCount] = React.useState(0);

  return (
    <main className="stage">
      <h1>Hello, React + TS <span className="wave">👋</span></h1>
      <p>
        Edit <code>src/App.tsx</code> and <code>src/styles.css</code> on the left,
        then hit <strong>Preview</strong> to see it render.
      </p>
      <button onClick={() => setCount((c) => c + 1)}>Click me</button>
      <p>Clicks: {count}</p>
    </main>
  );
}

const container = document.getElementById('root')!;
ReactDOM.createRoot(container).render(<App />);
`,
          },
          {
            id: makeId('file'),
            type: 'file',
            name: 'styles.css',
            isBinary: false,
            language: 'css',
            content: `:root {
  color-scheme: light dark;
  font-family: 'Segoe UI', system-ui, sans-serif;
}

body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 20% 20%, #05323c, #04151a 70%);
  color: #eafcff;
}

.stage {
  max-width: 32rem;
  padding: 2.5rem;
  text-align: center;
}

.wave {
  display: inline-block;
  animation: wave 1.6s ease-in-out infinite;
}

@keyframes wave {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(18deg); }
}

button {
  font: inherit;
  padding: 0.6rem 1.4rem;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  background: linear-gradient(135deg, #61dafb, #c6ff5e);
  color: #04151a;
  font-weight: 700;
}
`,
          },
        ],
      },
    ],
  };
}

export function createTreeForFramework(framework: Framework): FolderNode {
  return framework === 'react-ts' ? createReactTsTree() : createStaticTree();
}
