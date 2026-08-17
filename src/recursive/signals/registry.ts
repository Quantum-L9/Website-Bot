// L9_META: layer=recursive, role=engineering_signal_registry, status=active, version=1.0.0
// EngineeringSignalRegistry: deduplicates equivalent signals, clusters them by
// earliest responsible subsystem + failure fingerprint, and ranks clusters by
// categorical leverage (severity, recurrence, reach, confidence, risk).
// Exactly one coherent highest-leverage cluster may be selected per wave.

import { refForArtifact } from "../contracts/digest.js";
import type { EngineeringSignal, RecursiveArtifactRef } from "../contracts/types.js";

export interface SignalCluster {
  clusterId: string;
  subsystem: string;
  signalClass: EngineeringSignal["classification"];
  signals: EngineeringSignal[];
  dimensions: string[];
  confidence: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW";
  leverage: {
    severity: "BLOCKING" | "HIGH" | "MEDIUM" | "LOW";
    recurrence: "HIGH" | "MEDIUM" | "LOW";
    reach: EngineeringSignal["reach"];
    humanReviewImpact: "HIGH" | "MEDIUM" | "LOW";
    implementationRisk: "HIGH" | "MEDIUM" | "LOW";
    priority: "P0" | "P1" | "P2" | "P3";
  };
}

export interface ClusterRef {
  clusterId: string;
  digest: string;
  ref: RecursiveArtifactRef;
}

function equivalent(signal: EngineeringSignal, other: EngineeringSignal): boolean {
  if (signal.classification !== other.classification) return false;
  const subsystem = signal.causalTrace.suspectedOwner.subsystem;
  const otherSubsystem = other.causalTrace.suspectedOwner.subsystem;
  if (subsystem !== otherSubsystem) return false;
  const dimensions = signal.failureFingerprint?.qualityDimensions ?? [];
  const otherDimensions = other.failureFingerprint?.qualityDimensions ?? [];
  if (dimensions.length > 0 && otherDimensions.length > 0 && dimensions[0] !== otherDimensions[0])
    return false;
  return true;
}

function buildCluster(signals: EngineeringSignal[], signal: EngineeringSignal, index: number): SignalCluster {
  const dimensions = [
    ...new Set(
      signals
        .filter((other) => equivalent(signal, other))
        .flatMap((other) => other.failureFingerprint?.qualityDimensions ?? []),
    ),
  ];
  return {
    clusterId: `EC-${index + 1}`,
    subsystem: signal.causalTrace.suspectedOwner.subsystem,
    signalClass: signal.classification,
    signals: [signal],
    dimensions,
    confidence:
      signal.confidence === "HIGH" ? "HIGH" : signal.confidence === "MEDIUM" ? "MEDIUM" : "LOW",
    leverage: {
      severity: signal.severity,
      recurrence: signal.leverage.recurrence,
      reach: signal.reach,
      humanReviewImpact: signal.leverage.humanReviewImpact,
      implementationRisk: signal.leverage.implementationRisk,
      priority: "P2",
    },
  };
}

function scoreCluster(cluster: SignalCluster): void {
  const { severity, recurrence, reach, humanReviewImpact, implementationRisk } = cluster.leverage;
  const score =
    (severity === "BLOCKING" ? 4 : severity === "HIGH" ? 3 : severity === "MEDIUM" ? 2 : 1) +
    (recurrence === "HIGH" ? 2 : recurrence === "MEDIUM" ? 1 : 0) +
    (reach === "GLOBAL" ? 3 : reach === "CROSS_VERTICAL" ? 2 : reach === "VERTICAL" ? 1 : 0) +
    (humanReviewImpact === "HIGH" ? 2 : humanReviewImpact === "MEDIUM" ? 1 : 0) +
    (implementationRisk === "LOW" ? 2 : implementationRisk === "MEDIUM" ? 1 : 0);
  cluster.leverage.priority = score >= 10 ? "P0" : score >= 7 ? "P1" : score >= 4 ? "P2" : "P3";
}

export function clusterSignals(signals: EngineeringSignal[]): SignalCluster[] {
  const clusters: SignalCluster[] = [];
  for (const signal of signals) {
    const existing = clusters.find((cluster) => equivalent(signal, cluster.signals[0]));
    if (existing) {
      existing.signals.push(signal);
      continue;
    }
    clusters.push(buildCluster(signals, signal, clusters.length));
  }
  for (const cluster of clusters) scoreCluster(cluster);
  return clusters.sort((left, right) =>
    left.leverage.priority.localeCompare(right.leverage.priority),
  );
}

/**
 * Selects the single highest-leverage eligible cluster. Returns null when no
 * cluster is eligible (all low-confidence, or a material competing diagnosis
 * has not been disconfirmed).
 */
export function selectEligibleCluster(clusters: SignalCluster[]): SignalCluster | null {
  for (const cluster of clusters) {
    if (cluster.signalClass === "CONTROL_PLANE_CHANGE_REQUIRED") continue;
    if (cluster.confidence === "LOW") continue;
    const materialAlternative = cluster.signals.some(
      (signal) =>
        signal.strongestAlternative &&
        signal.strongestAlternative.confidence !== "LOW" &&
        signal.strongestAlternative.result !== "DISCONFIRMED",
    );
    if (materialAlternative) continue;
    return cluster;
  }
  return null;
}

export function hasControlPlaneSignal(clusters: SignalCluster[]): boolean {
  return clusters.some((cluster) => cluster.signalClass === "CONTROL_PLANE_CHANGE_REQUIRED");
}

export function clusterRefFor(cluster: SignalCluster): ClusterRef {
  const ref = refForArtifact("signal-cluster", {
    clusterId: cluster.clusterId,
    subsystem: cluster.subsystem,
    signalClass: cluster.signalClass,
    signalRefs: cluster.signals.map((signal) => signal.signalId),
  });
  return { clusterId: cluster.clusterId, digest: ref.digest, ref };
}
