import { Component } from "react";
import "./ErrorBoundary.css";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an unhandled error:", error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  handleHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="ev-error-boundary" role="alert" aria-label="Application error">
          <section className="ev-error-card">
            <div className="ev-error-banner">
              <span className="ev-error-banner-icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </span>
              <div className="ev-error-banner-content">
                <strong>Something went wrong</strong>
              </div>
            </div>
            <div className="ev-error-body">
              <h2 className="ev-error-title">We encountered an unexpected problem.</h2>
              <p className="ev-error-message">
                The page could not be displayed. Please reload to try again. If the problem continues, contact your LGU office for assistance.
              </p>
            </div>
            <div className="ev-error-actions">
              <button type="button" className="ds-btn ds-btn--ghost" onClick={this.handleHome}>
                Return to home
              </button>
              <button type="button" className="ds-btn ds-btn--primary" onClick={this.handleReload}>
                Reload page
              </button>
            </div>
          </section>
        </div>
      );
    }
    return this.props.children;
  }
}
