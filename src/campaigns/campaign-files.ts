// L9_META: layer=campaign, role=campaign_files, status=active, version=1.0.0
/**
 * File persistence for campaign learning records (design contract §3).
 * hypotheses/<LH-nnn>.json, candidates/<Cn>/*, campaign-learning.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LearningEvent } from "./types.js";

export function learningEventsPathOf(campaignRoot: string): string {
  return join(campaignRoot, "campaign-learning.json");
}

export function loadLearningEvents(campaignRoot: string): LearningEvent[] {
  const path = learningEventsPathOf(campaignRoot);
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${path} must contain a JSON array`);
  return parsed as LearningEvent[];
}

export function appendLearningEvent(campaignRoot: string, event: LearningEvent): void {
  mkdirSync(campaignRoot, { recursive: true });
  const path = learningEventsPathOf(campaignRoot);
  const events = loadLearningEvents(campaignRoot);
  if (events.some((item) => item.learning_id === event.learning_id)) return; // learning events are content-addressed and immutable
  events.push(event);
  writeFileSync(path, `${JSON.stringify(events, null, 2)}\n`, "utf8");
}
