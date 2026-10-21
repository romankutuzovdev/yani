import IORedis from "ioredis";

let connection: IORedis | null | undefined;
let redisDisabled = false;
let redisStatus = { ok: false, error: "not checked" };

export function crmRedisUrl() {
  return process.env.REDIS_URL?.trim() || process.env.CRM_REDIS_URL?.trim() || "";
}

export function getCrmRedis() {
  if (redisDisabled) return null;
  if (connection !== undefined) return connection;
  const url = crmRedisUrl();
  if (!url) {
    connection = null;
    redisStatus = { ok: false, error: "REDIS_URL не задан — polling fallback" };
    return null;
  }
  try {
    const redis = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 1500,
      retryStrategy: () => null,
    });
    redis.on("error", (err) => {
      redisStatus = { ok: false, error: err.message };
    });
    connection = redis;
    return connection;
  } catch (cause) {
    connection = null;
    redisDisabled = true;
    redisStatus = {
      ok: false,
      error: cause instanceof Error ? cause.message : "redis init failed",
    };
    return null;
  }
}

export function markCrmRedisDisabled(error: string) {
  redisDisabled = true;
  redisStatus = { ok: false, error };
  connection = null;
}

export function isCrmRedisDisabled() {
  return redisDisabled;
}

export async function pingCrmRedis() {
  if (redisDisabled) {
    return { status: "disabled" as const, error: redisStatus.error || "redis disabled" };
  }
  const url = crmRedisUrl();
  if (!url) {
    redisStatus = { ok: false, error: "REDIS_URL не задан — polling fallback" };
    return { status: "disabled" as const, error: redisStatus.error };
  }

  const redis = getCrmRedis();
  if (!redis) return { status: "disabled" as const, error: redisStatus.error };

  try {
    if (redis.status !== "ready") {
      await Promise.race([
        redis.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("redis timeout")), 1500)),
      ]);
    }
    const pong = await Promise.race([
      redis.ping(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("redis ping timeout")), 1500)),
    ]);
    redisStatus = { ok: pong === "PONG", error: "" };
    return { status: redisStatus.ok ? ("ok" as const) : ("error" as const), error: "" };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "redis ping failed";
    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
    markCrmRedisDisabled(message);
    return { status: "disabled" as const, error: message };
  }
}
