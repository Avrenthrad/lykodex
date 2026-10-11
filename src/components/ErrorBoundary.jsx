// Top-level crash safety net. Without this, any unhandled error
// anywhere in the component tree — a bad API response shape, a
// null reference, anything unanticipated — would take down the
// entire app to a blank white screen with zero recovery path. Given
// how much of this app depends on live third-party API responses
// (whose exact shape we can't fully guarantee), that's a real risk
// worth covering before real testers hit it.

import { Component } from "react";
import LykodexLogo from "./LykodexLogo";
import { routeHref, usesPathRouting } from "../lib/router";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Lykodex crashed:", error, info);
  }

  handleReload = () => {
    if (usesPathRouting()) {
      window.location.assign(routeHref("dashboard"));
    } else {
      window.location.hash = routeHref("dashboard");
      window.location.reload();
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="crash-screen">
        <LykodexLogo alt="" className="crash-screen__logo" />
        <h1 className="crash-screen__title">Something went wrong</h1>
        <p className="crash-screen__note">
          Lykodex hit an unexpected error. Your data is safe — this is just a display issue.
        </p>
        <button type="button" className="auth-form__submit" onClick={this.handleReload}>
          Reload Lykodex
        </button>
      </div>
    );
  }
}
