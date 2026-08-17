import { envVarsMatching, parseEnvExample, result, statusFromRows, writeJsonl } from "./lib.mjs";

const checks = [];

// Check for CRM environment variables
const envVars = parseEnvExample();
const crmEnvVars = envVarsMatching("crm", "hubspot", "salesforce", "acculynx");

checks.push(
  result({
    check_id: "crm-env-vars-defined",
    check_class: "environment_config",
    target_artifact: ".env.example",
    expected_result: "CRM environment variables defined",
    actual_result: crmEnvVars.length > 0
      ? `Found: ${crmEnvVars.join(", ")}`
      : "No CRM environment variables found",
    status: crmEnvVars.length > 0 ? "PASS" : "UNKNOWN",
    severity: "medium",
    remediation_if_failed: "Define CRM provider and API configuration in .env.example",
  }),
);

// Check for CRM provider configuration
const crmProviderVar = Object.keys(envVars).find((key) => key === "CRM_PROVIDER");
const crmProvider = crmProviderVar ? envVars[crmProviderVar] : null;

checks.push(
  result({
    check_id: "crm-provider-configured",
    check_class: "crm_config",
    target_artifact: "CRM_PROVIDER",
    expected_result: "CRM provider specified",
    actual_result: crmProvider ? `Provider: ${crmProvider}` : "CRM_PROVIDER not set",
    status: crmProvider ? "PASS" : "UNKNOWN",
    severity: "medium",
    remediation_if_failed: "Set CRM_PROVIDER to: acculynx, hubspot, salesforce, or none",
  }),
);

// Validate CRM provider value if set
if (crmProvider) {
  const validProviders = ["acculynx", "hubspot", "salesforce", "none"];
  const isValidProvider = validProviders.includes(crmProvider.toLowerCase());

  checks.push(
    result({
      check_id: "crm-provider-valid",
      check_class: "crm_config_validation",
      target_artifact: "CRM_PROVIDER",
      expected_result: `Valid CRM provider (${validProviders.join(", ")})`,
      actual_result: crmProvider,
      status: isValidProvider ? "PASS" : "FAIL",
      severity: "high",
      remediation_if_failed: `CRM_PROVIDER must be one of: ${validProviders.join(", ")}`,
    }),
  );

  // Check for provider-specific configuration
  if (crmProvider.toLowerCase() !== "none") {
    const requiredVars = {
      acculynx: ["CRM_API_BASE_URL", "CRM_API_TOKEN"],
      hubspot: ["CRM_API_TOKEN"],
      salesforce: ["CRM_CLIENT_ID", "CRM_CLIENT_SECRET"],
    };

    const required = requiredVars[crmProvider.toLowerCase()] || [];
    const missing = required.filter((varName) => !envVars[varName]);

    checks.push(
      result({
        check_id: "crm-provider-config-complete",
        check_class: "crm_provider_config",
        target_artifact: `${crmProvider} configuration`,
        expected_result: `Required variables: ${required.join(", ")}`,
        actual_result: missing.length === 0 ? "All required variables defined" : `Missing: ${missing.join(", ")}`,
        status: missing.length === 0 ? "PASS" : "FAIL",
        severity: "high",
        remediation_if_failed: `Define missing CRM variables: ${missing.join(", ")}`,
      }),
    );
  }
}

// Check test mode configuration
const testModeVar = envVars["CRM_TEST_MODE"];
checks.push(
  result({
    check_id: "crm-test-mode-configured",
    check_class: "crm_safety",
    target_artifact: "CRM_TEST_MODE",
    expected_result: "CRM test mode configured",
    actual_result: testModeVar ? `Test mode: ${testModeVar}` : "CRM_TEST_MODE not set",
    status: testModeVar ? "PASS" : "UNKNOWN",
    severity: "medium",
    remediation_if_failed: "Set CRM_TEST_MODE=true for development/testing",
  }),
);

writeJsonl("validation/crm_checks.jsonl", checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

if (status === "FAIL") process.exit(1);
