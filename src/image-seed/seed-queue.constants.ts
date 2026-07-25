export const SEED_QUEUE = 'fabric-seed';

/** Default images enqueued per seed call (manual batches). */
export const SEED_BATCH_SIZE = 500;
export const SEED_BATCH_SIZE_MAX = 1000;

/** Keep concurrency low to avoid Gemini quota / pricing spikes. */
export const SEED_CONCURRENCY = 2;
/** Max jobs started per minute (vision + embed ≈ 2 Gemini calls each). */
export const SEED_RATE_MAX = 20;
export const SEED_RATE_DURATION_MS = 60_000;

export const SEED_JOB_ATTEMPTS = 5;
export const SEED_JOB_BACKOFF_MS = 10_000;
