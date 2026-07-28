import { useVfs } from '../vfs/VfsContext';
import { IconClose } from './Icons';

export function EditorTabs() {
  const vfs = useVfs();

  if (vfs.tabs.length === 0) {
    return <div className="tabs-bar tabs-bar-empty" />;
  }

  return (
    <div className="tabs-bar">
      {vfs.tabs.map((id) => {
        const node = vfs.getNode(id);
        if (!node) return null;
        const active = id === vfs.activeId;
        return (
          <div
            key={id}
            className={`tab${active ? ' active' : ''}`}
            onClick={() => vfs.setActive(id)}
          >
            <span className="tab-name">{node.name}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                vfs.closeTab(id);
              }}
              aria-label={`Close ${node.name}`}
            >
              <IconClose width={10} height={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
