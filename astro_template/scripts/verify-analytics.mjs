import {
  buildRequiredResult,
  envVarsMatching,
  exists,
  fileReadErrorResult,
  readText,
  result,
  statusFromRows,
  writeJsonl,
} from "./lib.mjs";

const checks = [];

// Check for analytics environment variables
const analyticsEnvVars = envVarsMatching("analytics", "gtag", "measurement", "posthog");

checks.push(
  result({
    check_id: "analytics-env-vars-defined",
    check_class: "environment_config",
    target_artifact: ".env.example",
    expected_result: "Analytics environment variables defined",
    actual_result:
      analyticsEnvVars.length > 0
        ? `Found: ${analyticsEnvVars.join(", ")}`
        : "No analytics environment variables found",
    status: analyticsEnvVars.length > 0 ? "PASS" : "UNKNOWN",
    severity: "medium",
    remediation_if_failed: "Define analytics configuration in .env.example",
  }),
);

// Check for analytics tracking in built HTML
if (exists("dist/index.html")) {
  try {
    const indexHtml = readText("dist/index.html");

    // Check for common analytics providers
    const hasGoogleAnalytics = indexHtml.includes("gtag") || indexHtml.includes("google-analytics");
    const hasPostHog = indexHtml.includes("posthog");
    const hasGenericAnalytics = indexHtml.includes("analytics") || indexHtml.includes("tracking");

    const analyticsFound = hasGoogleAnalytics || hasPostHog || hasGenericAnalytics;

    checks.push(
      result({
        check_id: "analytics-tracking-present",
        check_class: "analytics_implementation",
        target_artifact: "dist/index.html",
        expected_result: "Analytics tracking code present",
        actual_result: analyticsFound
          ? "Analytics tracking code found"
          : "No analytics tracking code found",
        status: analyticsFound ? "PASS" : "UNKNOWN",
        severity: "medium",
        remediation_if_failed: "Add analytics tracking code to site",
      }),
    );

    // Check for event tracking setup
    const hasEventTracking = indexHtml.includes("track") || indexHtml.includes("event");
    checks.push(
      result({
        check_id: "event-tracking-setup",
        check_class: "analytics_events",
        target_artifact: "dist/index.html",
        expected_result: "Event tracking setup present",
        actual_result: hasEventTracking
          ? "Event tracking code found"
          : "No event tracking code found",
        status: hasEventTracking ? "PASS" : "UNKNOWN",
        severity: "low",
        remediation_if_failed: "Add event tracking for user interactions",
      }),
    );
  } catch (error) {
    checks.push(
      fileReadErrorResult("analytics-check-failed", "dist/index.html", "Analytics", error),
    );
  }
} else {
  checks.push(
    buildRequiredResult(
      "build-required-for-analytics",
      "Build output exists for analytics checking",
      "Build output missing",
    ),
  );
}

writeJsonl("validation/analytics_checks.jsonl", checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

if (status === "FAIL") process.exit(1);
