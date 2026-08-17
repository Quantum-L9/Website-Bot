import { exists, parseEnvExample, readText, result, statusFromRows, writeJsonl } from "./lib.mjs";

const checks = [];

// Check for analytics environment variables
const envVars = parseEnvExample();
const analyticsEnvVars = Object.keys(envVars).filter(
  (key) =>
    key.toLowerCase().includes("analytics") ||
    key.toLowerCase().includes("gtag") ||
    key.toLowerCase().includes("measurement") ||
    key.toLowerCase().includes("posthog"),
);

checks.push(
  result({
    check_id: "analytics-env-vars-defined",
    check_class: "environment_config",
    target_artifact: ".env.example",
    expected_result: "Analytics environment variables defined",
    actual_result: analyticsEnvVars.length > 0
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
        actual_result: analyticsFound ? "Analytics tracking code found" : "No analytics tracking code found",
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
        actual_result: hasEventTracking ? "Event tracking code found" : "No event tracking code found",
        status: hasEventTracking ? "PASS" : "UNKNOWN",
        severity: "low",
        remediation_if_failed: "Add event tracking for user interactions",
      }),
    );
  } catch (error) {
    checks.push(
      result({
        check_id: "analytics-check-failed",
        check_class: "file_access",
        target_artifact: "dist/index.html",
        expected_result: "Analytics check completed",
        actual_result: `Error reading file: ${error.message}`,
        status: "UNKNOWN",
        severity: "low",
        remediation_if_failed: "Ensure build output is readable",
      }),
    );
  }
} else {
  checks.push(
    result({
      check_id: "build-required-for-analytics",
      check_class: "prerequisite",
      target_artifact: "dist/",
      expected_result: "Build output exists for analytics checking",
      actual_result: "Build output missing",
      status: "BLOCKED",
      severity: "medium",
      remediation_if_failed: "Run npm run build first",
    }),
  );
}

writeJsonl("validation/analytics_checks.jsonl", checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

if (status === "FAIL") process.exit(1);
