import { useState, useEffect, useRef } from 'react';
import { useTabStore } from '../store/tabStore';

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, addTab, removeTab, reorderTabs } = useTabStore();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollLeft, setShowScrollLeft] = useState(false);
  const [showScrollRight, setShowScrollRight] = useState(false);

  // Check scroll overflow
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const checkScroll = () => {
      setShowScrollLeft(container.scrollLeft > 0);
      setShowScrollRight(container.scrollLeft + container.clientWidth < container.scrollWidth - 1);
    };

    checkScroll();
    container.addEventListener('scroll', checkScroll);
    const observer = new ResizeObserver(checkScroll);
    observer.observe(container);

    return () => {
      container.removeEventListener('scroll', checkScroll);
      observer.disconnect();
    };
  }, [tabs.length]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+Tab: cycle to next tab
        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          const currentIndex = tabs.findIndex(t => t.id === activeTabId);
          const nextIndex = (currentIndex + 1) % tabs.length;
          setActiveTab(tabs[nextIndex].id);
        }
        // Ctrl+Shift+Tab: cycle to previous tab
        if (e.key === 'Tab' && e.shiftKey) {
          e.preventDefault();
          const currentIndex = tabs.findIndex(t => t.id === activeTabId);
          const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
          setActiveTab(tabs[prevIndex].id);
        }
        // Ctrl+1-9: jump to tab
        const num = parseInt(e.key);
        if (num >= 1 && num <= 9 && tabs.length >= num) {
          e.preventDefault();
          setActiveTab(tabs[num - 1].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabs, activeTabId, setActiveTab]);

  const handleAddTab = () => {
    const activeTab = tabs.find(t => t.id === activeTabId);
    addTab({ title: 'New Query', connectionId: activeTab?.connectionId || undefined });
  };

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    removeTab(tabId);
  };

  const handleMouseDown = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {
      e.preventDefault();
      removeTab(tabId);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  const handleCloseOthers = (tabId: string) => {
    tabs.filter(t => t.id !== tabId).forEach(t => removeTab(t.id));
    setContextMenu(null);
  };

  const handleCloseAll = () => {
    tabs.forEach(t => removeTab(t.id));
    setContextMenu(null);
  };

  const handleDuplicateTab = (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      addTab({
        title: tab.title,
        connectionId: tab.connectionId || undefined,
        tableName: tab.tableName || undefined,
        query: tab.query,
      });
    }
    setContextMenu(null);
  };

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      reorderTabs(dragIndex, index);
      setDragIndex(index);
    }
  };

  const handleDragEnd = () => {
    setDragIndex(null);
  };

  const scrollTabs = (direction: 'left' | 'right') => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollBy({ left: direction === 'left' ? -200 : 200, behavior: 'smooth' });
  };

  return (
    <div className="tab-bar" onClick={() => setContextMenu(null)}>
      {/* Scroll left arrow */}
      {showScrollLeft && (
        <button className="tab-scroll-btn" onClick={() => scrollTabs('left')} title="Scroll tabs left">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}

      <div className="tab-bar-tabs" ref={scrollContainerRef}>
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            className={`tab-bar-tab ${tab.id === activeTabId ? 'active' : ''} ${dragIndex === index ? 'dragging' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            onMouseDown={(e) => handleMouseDown(e, tab.id)}
            onContextMenu={(e) => handleContextMenu(e, tab.id)}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            title={`${tab.title}${tab.connectionId ? ` - ${tab.connectionId}` : ''}`}
          >
            <span className="tab-bar-tab-title">
              {tab.tableName ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                  {tab.title}
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                  {tab.title}
                </>
              )}
            </span>
            <button
              className="tab-bar-tab-close"
              onClick={(e) => handleCloseTab(e, tab.id)}
              title="Close tab"
            >
              {tab.isDirty ? (
                <span className="tab-dirty-dot" />
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              )}
            </button>
          </div>
        ))}
        <button className="tab-bar-add" onClick={handleAddTab} title="New Query Tab (Ctrl+T)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Scroll right arrow */}
      {showScrollRight && (
        <button className="tab-scroll-btn" onClick={() => scrollTabs('right')} title="Scroll tabs right">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 1000 }}
        >
          <button className="context-menu-item" onClick={() => { removeTab(contextMenu.tabId); setContextMenu(null); }}>
            Close
          </button>
          <button className="context-menu-item" onClick={() => handleCloseOthers(contextMenu.tabId)}>
            Close Others
          </button>
          <button className="context-menu-item" onClick={handleCloseAll}>
            Close All
          </button>
          <div className="dropdown-divider" />
          <button className="context-menu-item" onClick={() => handleDuplicateTab(contextMenu.tabId)}>
            Duplicate Tab
          </button>
        </div>
      )}
    </div>
  );
}
