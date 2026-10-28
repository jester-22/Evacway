import "./LoadingState.css";

export default function LoadingState({
  message = "Loading...",
  size = "md", // "sm" | "md" | "lg"
  overlay = false,
  inline = false,
  className = "",
  style = {},
}) {
  return (
    <div
      className={`evacway-loading-container ${overlay ? "is-overlay" : ""} ${
        inline ? "is-inline" : ""
      } ${className}`}
      style={style}
      role="status"
      aria-live="polite"
    >
      <div className={`evacway-spinner size-${size}`} aria-hidden="true" />
      {message && <p className="evacway-loading-message">{message}</p>}
    </div>
  );
}

