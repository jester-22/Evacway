import { Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons'
import './ui.css'

export default function Breadcrumb({
  items = [],
  icon = faArrowLeft,
  ariaLabel = 'Breadcrumb',
  className = '',
}) {
  if (!Array.isArray(items) || items.length === 0) return null

  return (
    <nav className={`ui-breadcrumb ${className}`.trim()} aria-label={ariaLabel}>
      <ol className="ui-breadcrumb__list">
        {items.map((item, index) => {
          const isFirst = index === 0
          const isLast = index === items.length - 1
          const key = item.key ?? `${item.label}-${index}`

          const content = (
            <>
              {isFirst && icon && (
                <FontAwesomeIcon
                  icon={icon}
                  className="ui-breadcrumb__icon"
                  aria-hidden="true"
                />
              )}
              <span>{item.label}</span>
            </>
          )

          return (
            <li key={key} className="ui-breadcrumb__item">
              {index > 0 && (
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className="ui-breadcrumb__sep"
                  aria-hidden="true"
                />
              )}
              {isLast ? (
                <span className="ui-breadcrumb__current" aria-current="page">
                  {content}
                </span>
              ) : item.to ? (
                <Link
                  to={item.to}
                  className="ui-breadcrumb__link"
                  onClick={item.onClick}
                >
                  {content}
                </Link>
              ) : item.href ? (
                <a
                  href={item.href}
                  className="ui-breadcrumb__link"
                  onClick={item.onClick}
                >
                  {content}
                </a>
              ) : (
                <button
                  type="button"
                  className="ui-breadcrumb__link"
                  onClick={item.onClick}
                >
                  {content}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
