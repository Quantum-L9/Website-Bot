#!/usr/bin/env node

if (!process.env.INNGEST_EVENT_KEY) {
  console.error(
    'INNGEST_EVENT_KEY is required to fire website/pipeline.requested — set the repository secret and retry.',
  );
  process.exit(1);
}

const { Inngest } = await import('inngest');

const client = new Inngest({
  id: 'website-bot',
  eventKey: process.env.INNGEST_EVENT_KEY,
});

try {
  await client.send({
    name: 'website/pipeline.requested',
    data: {
      specPath: process.env.SPEC_PATH,
      costCapUsd: Number.parseFloat(process.env.COST_CAP_USD),
      dryRun: process.env.DRY_RUN === 'true',
      runId: process.env.GH_RUN_ID,
      triggeredBy: process.env.GH_ACTOR,
    },
  });
  console.log('Event sent');
} catch (error) {
  console.error(error);
  process.exit(1);
}
