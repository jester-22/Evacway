import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faEllipsisVertical } from '@fortawesome/free-solid-svg-icons'

/**
 * FloatingMenu - A shared portal-based menu component
 * Renders in a portal on document.body with position: fixed
 * - Right-aligned to trigger, 4px below
 * - Flips above if not enough space below
 * - Clamps to viewport with 8px margin
 * - Uses design-system tokens for styling
 */
export function FloatingMenu({
  items = [],
  triggerRef,
  open,
  onClose,
  align = 'right',
  zIndex = 1100, // Above sticky headers (z-index: 1000), below modal backdrop (5000)
}) {
  const menuRef = useRef(null)
  const previousFocusRef = useRef(null)

  // Filter out falsy items (dividers, null, undefined) but keep items with label
  const validItems = items.filter((item) => item && item.label)

  // Calculate menu position
  const [position, setPosition] = useState({ top: 0, left: 0, right: 'auto', bottom: 'auto', flipped: false })

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !menuRef.current) return

    const triggerRect = triggerRef.current.getBoundingClientRect()
    const menuRect = menuRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const margin = 8

    // Default: below trigger, right-aligned
    let top = triggerRect.bottom + 4
    let left = align === 'right' ? triggerRect.right - menuRect.width : triggerRect.left
    let flipped = false

    // Clamp horizontally
    if (left < margin) left = margin
    if (left + menuRect.width > viewportWidth - margin) {
      left = viewportWidth - margin - menuRect.width
    }

    // Check if we need to flip above
    const spaceBelow = viewportHeight - triggerRect.bottom
    if (spaceBelow < menuRect.height + margin && triggerRect.top > spaceBelow) {
      flipped = true
      top = triggerRect.top - menuRect.height - 4
    }

    // Clamp vertically
    if (top < margin) top = margin
    if (top + menuRect.height > viewportHeight - margin) {
      top = viewportHeight - margin - menuRect.height
    }

    setPosition({ top, left, right: 'auto', bottom: 'auto', flipped })
  }, [triggerRef, align])

  // Update position when open, on scroll, resize
  useEffect(() => {
    if (!open) return
    updatePosition()
    window.addEventListener('scroll', updatePosition, { passive: true })
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  // Focus management and keyboard navigation
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement
      // Focus first menu item after render
      setTimeout(() => {
        menuRef.current?.querySelector('[role="menuitem"]')?.focus()
      }, 0)
    } else if (previousFocusRef.current) {
      // Return focus to trigger
      previousFocusRef.current.focus()
      previousFocusRef.current = null
    }
  }, [open])

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e) => {
      if (!open) return

      const items = menuRef.current?.querySelectorAll('[role="menuitem"]')
      if (!items?.length) return

      const currentIndex = Array.from(items).findIndex((el) => el === document.activeElement)

      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          onClose()
          break
        case 'ArrowDown':
          e.preventDefault()
          if (currentIndex < items.length - 1) {
            items[currentIndex + 1].focus()
          } else {
            items[0].focus()
          }
          break
        case 'ArrowUp':
          e.preventDefault()
          if (currentIndex > 0) {
            items[currentIndex - 1].focus()
          } else {
            items[items.length - 1].focus()
          }
          break
        case 'Home':
          e.preventDefault()
          items[0].focus()
          break
        case 'End':
          e.preventDefault()
          items[items.length - 1].focus()
          break
        case 'Enter':
        case ' ':
          if (document.activeElement?.matches('[role="menuitem"]')) {
            document.activeElement.click()
          }
          break
        case 'Tab':
          // Close on Tab (forward focus out of menu)
          onClose()
          break
      }
    },
    [open, onClose]
  )

  // Outside click handler
  useEffect(() => {
    if (!open) return
    function onMouseDown(e) {
      // Close if click is outside menu and not on trigger
      if (menuRef.current && !menuRef.current.contains(e.target) && triggerRef.current && !triggerRef.current.contains(e.target)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open, onClose, triggerRef])

  if (!open || validItems.length === 0) return null

  const menuContent = (
    <ul
      ref={menuRef}
      role="menu"
      className="ds-menu ec-floating-menu"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        right: position.right,
        bottom: position.bottom,
        zIndex,
        minWidth: '180px',
        boxShadow: 'var(--shadow-md)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-card)',
        backgroundColor: 'var(--surface)',
        padding: 'var(--space-2) 0',
        margin: 0,
        listStyle: 'none',
        boxSizing: 'border-box',
      }}
      onKeyDown={handleKeyDown}
    >
      {validItems.map((item, index) => (
        <li key={index} role="none">
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={item.danger ? 'ds-menu__item ds-menu__item--danger' : 'ds-menu__item'}
            onClick={() => {
              onClose()
              item.onClick?.()
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              width: '100%',
              minHeight: 'var(--control-height)',
              padding: '0 var(--space-4)',
              backgroundColor: 'transparent',
              border: 'none',
              color: item.danger ? 'var(--danger)' : 'var(--text)',
              fontFamily: 'var(--font-body)',
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-medium)',
              textAlign: 'left',
              textDecoration: 'none',
              cursor: 'pointer',
              boxSizing: 'border-box',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = item.danger ? 'var(--danger-soft)' : 'var(--neutral-soft)'
              e.currentTarget.style.color = item.danger ? 'var(--danger)' : 'var(--ink)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.color = item.danger ? 'var(--danger)' : 'var(--text)'
            }}
          >
            {item.icon && <FontAwesomeIcon icon={item.icon} size="xs" style={{ marginRight: 'var(--space-2)' }} />}
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  )

  return createPortal(menuContent, document.body)
}

/**
 * FloatingMenuTrigger - Wrapper that provides the trigger button and manages open state
 */
export function FloatingMenuTrigger({
  items = [],
  label = 'More actions',
  align = 'right',
  zIndex = 1100,
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)

  const toggle = useCallback(() => setOpen((p) => !p), [])
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ds-btn ds-btn--icon ds-btn--ghost"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <FontAwesomeIcon icon={faEllipsisVertical} />
      </button>
      <FloatingMenu
        items={items}
        triggerRef={triggerRef}
        open={open}
        onClose={close}
        align={align}
        zIndex={zIndex}
      />
    </>
  )
}

// Re-export for convenience
export default FloatingMenu