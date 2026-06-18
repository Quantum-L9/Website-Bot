// L9_META: layer=core, role=logger, status=active, version=2.0.0
import pino from 'pino';

const root = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

export function createModuleLogger(module: string) {
  return root.child({ module });
}
