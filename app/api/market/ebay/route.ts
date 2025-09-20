import { withCORS } from '@/src/lib/cors';

export const POST = withCORS(async (req) => {
  const { comicTitle, issueNumber, publisher, year, gradeRange, max } = await req.json();
  // Call eBay findCompletedItems/sell APIs with your APP_ID/OAuth token here, normalize & return stats
  // (You already have client logic; move that logic here and remove keys from app)
  return Response.json({ sales: [], gradeAverages: [], salesCount: 0 });
});
