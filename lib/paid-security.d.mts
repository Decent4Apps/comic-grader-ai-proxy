export function authorizePaidRequest(req: Request, options?: { env?: Record<string, string | undefined>; fetcher?: typeof fetch }): Promise<Response | null>;
export function readPaidJson(req: Request, maxBytes?: number): Promise<any>;
export function boundAIInput(body: any, env?: Record<string, string | undefined>): any;
