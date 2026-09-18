import { RUN_LIMITS, getRuntimeConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const config = getRuntimeConfig();
  return Response.json(
    {
      status: "ok",
      configured: Boolean(config.apiKey),
      model: config.model,
      securityJudgeModel: config.securityJudgeModel,
      demoMode: config.demoMode,
      limits: RUN_LIMITS,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
