import { Component } from "react";

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

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: "36px 24px",
            maxWidth: "600px",
            margin: "48px auto",
            background: "#ffffff",
            borderRadius: "12px",
            boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
            fontFamily: "system-ui, -apple-system, sans-serif",
            color: "#0f172a",
            border: "1px solid #fee2e2",
            boxSizing: "border-box",
          }}
          role="alert"
        >
          <h2 style={{ margin: "0 0 12px", color: "#dc2626", fontSize: "20px", fontWeight: 700 }}>
            Something went wrong
          </h2>
          <p style={{ margin: "0 0 16px", color: "#475569", fontSize: "14px", lineHeight: "1.5" }}>
            An unexpected error occurred while rendering this view:
          </p>
          <pre
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "12px 14px",
              fontSize: "12.5px",
              color: "#b91c1c",
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              marginBottom: "20px",
            }}
          >
            {this.state.error?.message || "Unknown error"}
          </pre>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              background: "#2563eb",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              padding: "10px 18px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              minHeight: "44px",
            }}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
