import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.32.0';

export interface SystemLogPayload {
  functionName: string;
  callerType: 'CRON' | 'USER' | 'ANON' | 'SYSTEM';
  userId?: string | null;
  userEmail?: string | null;
  httpMethod?: string;
  requestPayload?: any;
  responseStatus: number;
  responseData?: any;
  durationMs: number;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  errorMessage?: string | null;
}

export interface UserAuditPayload {
  userId?: string | null;
  userEmail?: string | null;
  action: string;
  category: 'AUTH' | 'PORTFOLIO' | 'WATCHLIST' | 'PAPER_TRADE' | 'SETTINGS' | 'AI';
  entityType: string;
  entityId?: string | null;
  oldState?: any;
  newState?: any;
  clientIp?: string | null;
  userAgent?: string | null;
  status?: 'SUCCESS' | 'FAILED';
  failureReason?: string | null;
}

/**
 * Strips or masks sensitive fields like passwords and auth tokens
 */
export function sanitizePayload(payload: any): any {
  if (!payload || typeof payload !== 'object') return payload;

  if (Array.isArray(payload)) {
    return payload.map(sanitizePayload);
  }

  const sanitized: Record<string, any> = {};
  const sensitiveKeys = ['password', 'authorization', 'token', 'secret', 'smtp_pass', 'service_role'];

  for (const [key, value] of Object.entries(payload)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
      sanitized[key] = '***REDACTED***';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizePayload(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Creates an admin Supabase client inside Edge Functions
 */
export function getAdminClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  return createClient(supabaseUrl, serviceRoleKey);
}

/**
 * Asynchronously writes to system_execution_logs table
 */
export async function logSystemExecution(log: SystemLogPayload): Promise<void> {
  try {
    const supabase = getAdminClient();
    await supabase.from('system_execution_logs').insert({
      function_name: log.functionName,
      caller_type: log.callerType,
      user_id: log.userId || null,
      user_email: log.userEmail || null,
      http_method: log.httpMethod || 'POST',
      request_payload: log.requestPayload ? sanitizePayload(log.requestPayload) : null,
      response_status: log.responseStatus,
      response_data: log.responseData || null,
      duration_ms: Math.round(log.durationMs || 0),
      status: log.status,
      error_message: log.errorMessage || null,
    });
  } catch (err) {
    console.error(`[systemLogger] Failed to write system execution log for ${log.functionName}:`, err);
  }
}

/**
 * Asynchronously writes to user_audit_logs table
 */
export async function logUserAudit(audit: UserAuditPayload): Promise<void> {
  try {
    const supabase = getAdminClient();
    await supabase.from('user_audit_logs').insert({
      user_id: audit.userId || null,
      user_email: audit.userEmail || null,
      action: audit.action,
      category: audit.category,
      entity_type: audit.entityType,
      entity_id: audit.entityId || null,
      old_state: audit.oldState || null,
      new_state: audit.newState || null,
      client_ip: audit.clientIp || null,
      user_agent: audit.userAgent || null,
      status: audit.status || 'SUCCESS',
      failure_reason: audit.failureReason || null,
    });
  } catch (err) {
    console.error(`[systemLogger] Failed to write user audit log for ${audit.action}:`, err);
  }
}

/**
 * Standard High-Performance Logging Middleware for Edge Functions
 */
export function withSystemLogging(
  functionName: string,
  handler: (req: Request) => Promise<Response>,
  options?: {
    payloadFilter?: (body: any) => any;
  }
) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        },
      });
    }

    const startTime = performance.now();
    let requestPayload: any = null;
    let userId: string | null = null;
    let userEmail: string | null = null;
    let callerType: 'CRON' | 'USER' | 'ANON' | 'SYSTEM' = 'CRON';
    const userAgent = req.headers.get('user-agent') || '';
    const isPgNet = userAgent.toLowerCase().includes('pg_net') || userAgent.toLowerCase().includes('postgresql');

    // Clone request to inspect auth and payload without consuming stream
    try {
      const clonedReq = req.clone();
      const authHeader = clonedReq.headers.get('Authorization');
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

      if (authHeader) {
        const token = authHeader.replace(/^Bearer /i, '').trim();
        if (token && serviceRoleKey && token === serviceRoleKey) {
          callerType = 'SYSTEM';
        } else if (token && token !== anonKey) {
          try {
            const admin = getAdminClient();
            const { data: { user } } = await admin.auth.getUser(token);
            if (user) {
              userId = user.id;
              userEmail = user.email ?? null;
              callerType = 'USER';
            } else if (isPgNet || functionName.startsWith('sync-')) {
              callerType = 'CRON';
            } else {
              callerType = 'ANON';
            }
          } catch {
            callerType = (isPgNet || functionName.startsWith('sync-')) ? 'CRON' : 'ANON';
          }
        } else {
          // Anon key or no user JWT
          callerType = (isPgNet || functionName.startsWith('sync-')) ? 'CRON' : 'ANON';
        }
      } else {
        callerType = (isPgNet || functionName.startsWith('sync-')) ? 'CRON' : 'ANON';
      }

      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        const text = await clonedReq.text();
        if (text) {
          try {
            requestPayload = JSON.parse(text);
          } catch {
            requestPayload = { raw: text.substring(0, 1000) };
          }
        }
      } else if (req.method === 'GET') {
        const url = new URL(req.url);
        const params: Record<string, string> = {};
        url.searchParams.forEach((v, k) => { params[k] = v; });
        requestPayload = Object.keys(params).length > 0 ? params : null;
      }
    } catch {
      // ignore parse errors
    }

    let response: Response;
    let responseBodyData: any = null;
    let errorMessage: string | null = null;
    let status: 'SUCCESS' | 'FAILED' | 'SKIPPED' = 'SUCCESS';

    try {
      response = await handler(req);

      // Clone response to capture exact response data
      try {
        const clonedRes = response.clone();
        const resText = await clonedRes.text();
        if (resText) {
          try {
            responseBodyData = JSON.parse(resText);
          } catch {
            responseBodyData = { text: resText.substring(0, 1000) };
          }
        }
      } catch {
        responseBodyData = null;
      }

      if (response.status >= 400) {
        status = 'FAILED';
        errorMessage = responseBodyData?.error || responseBodyData?.message || `HTTP ${response.status}`;
      } else if (responseBodyData?.skipped === true) {
        status = 'SKIPPED';
      } else {
        status = 'SUCCESS';
      }
    } catch (err: any) {
      status = 'FAILED';
      errorMessage = err.message || String(err);
      response = new Response(JSON.stringify({ error: errorMessage }), {
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      });
      responseBodyData = { error: errorMessage, stack: err.stack };
    }

    const durationMs = performance.now() - startTime;

    // Apply custom payload filter if configured
    let finalResponseData = responseBodyData;
    if (options?.payloadFilter && status === 'SUCCESS') {
      try {
        finalResponseData = options.payloadFilter(responseBodyData);
      } catch {
        finalResponseData = responseBodyData;
      }
    }

    // Non-blocking log insert
    const logPromise = logSystemExecution({
      functionName,
      callerType,
      userId,
      userEmail,
      httpMethod: req.method,
      requestPayload,
      responseStatus: response.status,
      responseData: finalResponseData,
      durationMs,
      status,
      errorMessage,
    });

    const edgeGlobal = globalThis as any;
    if (typeof edgeGlobal.EdgeRuntime !== 'undefined' && edgeGlobal.EdgeRuntime.waitUntil) {
      edgeGlobal.EdgeRuntime.waitUntil(logPromise);
    } else {
      logPromise.catch(() => {});
    }

    return response;
  };
}
