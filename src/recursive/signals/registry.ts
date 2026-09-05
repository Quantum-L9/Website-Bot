// L9_META: layer=recursive, role=engineering_signal_registry, status=active, version=1.0.0
// EngineeringSignalRegistry: deduplicates equivalent signals, clusters them by
// earliest responsible subsystem + failure fingerprint, and ranks clusters by
// categorical leverage (severity, recurrence, reach, confidence, risk).
// Exactly one coherent highest-leverage cluster may be selected per wave.

import { refForArtifact } from "../contracts/digest.js";
import type { EngineeringSignal, RecursiveArtifactRef } from "../contracts/types.js";

/** The three-level scale the leverage fields share (typescript:S4323). */
type LeverageScale = "HIGH" | "MEDIUM" | "LOW";

type LeverageSeverity = "BLOCKING" | "HIGH" | "MEDIUM" | "LOW";

export interface SignalCluster {
  clusterId: string;
  subsystem: string;
  signalClass: EngineeringSignal["classification"];
  signals: EngineeringSignal[];
  dimensions: string[];
  confidence: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW";
  leverage: {
    severity: LeverageSeverity;
    recurrence: LeverageScale;
    reach: EngineeringSignal["reach"];
    humanReviewImpact: LeverageScale;
    implementationRisk: LeverageScale;
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

function weightedScore(weights: Record<string, number>, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return weights[value] ?? fallback;
}

function confidenceOf(value: EngineeringSignal["confidence"]): SignalCluster["confidence"] {
  if (value === "HIGH") return "HIGH";
  if (value === "MEDIUM") return "MEDIUM";
  return "LOW";
}

function priorityFor(score: number): SignalCluster["leverage"]["priority"] {
  if (score >= 10) return "P0";
  if (score >= 7) return "P1";
  if (score >= 4) return "P2";
  return "P3";
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
    confidence: confidenceOf(signal.confidence),
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
    weightedScore({ BLOCKING: 4, HIGH: 3, MEDIUM: 2 }, severity, 1) +
    weightedScore({ HIGH: 2, MEDIUM: 1 }, recurrence, 0) +
    weightedScore({ GLOBAL: 3, CROSS_VERTICAL: 2, VERTICAL: 1 }, reach, 0) +
    weightedScore({ HIGH: 2, MEDIUM: 1 }, humanReviewImpact, 0) +
    weightedScore({ LOW: 2, MEDIUM: 1 }, implementationRisk, 0);
  cluster.leverage.priority = priorityFor(score);
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
