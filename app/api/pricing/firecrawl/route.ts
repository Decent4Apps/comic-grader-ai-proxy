import { withCORS } from "@/src/lib/cors";
import { db } from "@/src/db/client";
import { pricingCache } from "@/src/db/schema";
import { and, eq, gt } from "drizzle-orm";

export const runtime = "nodejs";

type QueryInput = {
  comicTitle: string;
  issueNumber?: string;
  publisher?: string;
  year?: string;
  gradeRange?: { min: number; max: number };
  max?: number;
  cacheTtlMinutes?: number;
  bypassCache?: boolean;
};

type Comp = {
  price: number;
  currency: "USD";
  title?: string;
  source: string;
  url: string;
  snippet?: string;
  date?: string;
};

type PricingPayload = {
  ok: true;
  query: Record<string, any>;
  stats: { count: number; averageUsd: number | null; medianUsd: number | null };
  comps: Comp[];
};

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2/search";

export const POST = withCORS(async (req) => {
  if (!process.env.FIRECRAWL_API_KEY) {
    return Response.json({ error: "FIRECRAWL
