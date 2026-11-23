import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { SlidersHorizontal, X } from 'lucide-react'
import './ui.css'

export default function MobileFilterButton({
  activeCount = 0,
  title = 'Filters',
  label = 'Filter',
  onReset,
  children,
  className = '',
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const hasActive = Number(activeCount) > 0

  return (
    <>
      <button
        type="button"
        className={`ui-mobile-filter-btn ${hasActive ? 'is-active' : ''} ${className}`.trim()}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={hasActive ? `${title} (${activeCount} active)` : title}
      >
        <SlidersHorizontal size={15} strokeWidth={2} aria-hidden="true" />
        <span>{label}</span>
        {hasActive && (
          <span className="ui-mobile-filter-btn__badge" aria-hidden="true">
            {activeCount}
          </span>
        )}
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="ui-mobile-filter-backdrop"
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget) setOpen(false)
            }}
          >
            <section
              className="ui-mobile-filter-sheet"
              role="dialog"
              aria-modal="true"
              aria-label={title}
            >
              <div className="ui-mobile-filter-sheet__handle" aria-hidden="true" />
              <header className="ui-mobile-filter-sheet__header">
                <h3 className="ui-mobile-filter-sheet__title">{title}</h3>
                <div className="ui-mobile-filter-sheet__header-actions">
                  {hasActive && typeof onReset === 'function' && (
                    <button
                      type="button"
                      className="ui-mobile-filter-sheet__reset"
                      onClick={onReset}
                    >
                      Reset
                    </button>
                  )}
                  <button
                    type="button"
                    className="ui-mobile-filter-sheet__close"
                    onClick={() => setOpen(false)}
                    aria-label="Close filters"
                  >
                    <X size={18} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              </header>

              <div className="ui-mobile-filter-sheet__body">{children}</div>

              <footer className="ui-mobile-filter-sheet__footer">
                <button
                  type="button"
                  className="ui-btn ui-btn--primary ui-mobile-filter-sheet__done"
                  onClick={() => setOpen(false)}
                >
                  Done
                </button>
              </footer>
            </section>
          </div>,
          document.body
        )}
    </>
  )
}
