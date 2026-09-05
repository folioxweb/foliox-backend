import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.32.0'
import { encode as encodeBase64 } from "https://deno.land/std@0.192.0/encoding/base64.ts"
import { withSystemLogging } from '../_shared/systemLogger.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const TARGET_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash"
];

function cleanGeminiResponse(text: string): string {
  if (!text) return "";
  return text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function getPrompt(documentType: string, docTitle: string): string {
  return `You are an expert equity research analyst.
Analyze this corporate announcement/filing for the financial market.
Document Title: "${docTitle}"
Document Type: "${documentType || 'GENERAL'}"

Return ONLY a valid, parseable JSON object matching this exact schema:
{
  "announcementType": "string (e.g. Quarterly Results, Investor Presentation, Dividend, Board Meeting Outcome, etc.)",
  "marketImpact": "High | Medium | Low",
  "summary": "string (concise 2-3 sentence executive summary of key decisions/numbers)",
  "keyTakeaways": [
    "string"
  ],
  "financialHighlights": [
    "string"
  ],
  "importantNumbers": [
    {
      "label": "string",
      "value": "string"
    }
  ],
  "positives": [
    "string"
  ],
  "negatives": [
    "string"
  ],
  "risks": [
    "string"
  ],
  "managementCommentary": "string",
  "futureOutlook": "string",
  "sentiment": "Positive | Neutral | Negative"
}`;
}

serve(withSystemLogging('generate-ai-summary', async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      serviceRoleKey || anonKey || '',
      authHeader && !serviceRoleKey ? { global: { headers: { Authorization: authHeader } } } : undefined
    );

    const body = await req.json().catch(() => ({}));
    const targetAttachmentId = body.attachment_id || body.documentId || body.attachmentId || body.id;

    if (!targetAttachmentId) {
      throw new Error('attachment_id / documentId is required');
    }

    const { data: doc, error: docErr } = await supabaseAdmin
      .from('company_documents')
      .select('attachment_id, pdf_url, title, document_type, reporting_period, ai_status, ai_summary_json, ai_model')
      .eq('attachment_id', targetAttachmentId)
      .maybeSingle();

    if (docErr || !doc) {
      throw new Error(`Document not found for ID: ${targetAttachmentId}`);
    }

    // Return cached summary instantly if already completed by Gemini AI
    if (doc.ai_status === 'COMPLETED' && doc.ai_summary_json && doc.ai_model?.startsWith('gemini')) {
      return new Response(JSON.stringify({
        success: true,
        data: {
          cached: true,
          aiSummary: doc.ai_summary_json,
          model: doc.ai_model
        },
        aiSummary: doc.ai_summary_json
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    }

    const apiKey = body.apiKey || body.geminiApiKey || body.gemini_api_key || Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_API_KEY') || '';
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured. Please set GEMINI_API_KEY in Supabase Edge Function Secrets or Project Settings.');
    }

    await supabaseAdmin
      .from('company_documents')
      .update({ ai_status: 'IN_PROGRESS' })
      .eq('attachment_id', targetAttachmentId);

    const promptText = getPrompt(doc.document_type, doc.title);
    const parts: any[] = [{ text: promptText }];

    // Fetch PDF from BSE with 25s timeout
    if (doc.pdf_url) {
      try {
        const downloadController = new AbortController();
        const downloadTimeout = setTimeout(() => downloadController.abort(), 25000);

        const pdfRes = await fetch(doc.pdf_url, {
          signal: downloadController.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Referer': 'https://www.bseindia.com/'
          }
        });
        clearTimeout(downloadTimeout);

        if (pdfRes.ok) {
          const pdfBuffer = await pdfRes.arrayBuffer();
          if (pdfBuffer.byteLength > 0 && pdfBuffer.byteLength < 15 * 1024 * 1024) {
            
            // Initiate Resumable Upload to Gemini File API
            const initRes = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
              method: 'POST',
              headers: {
                'X-Goog-Upload-Protocol': 'resumable',
                'X-Goog-Upload-Command': 'start',
                'X-Goog-Upload-Header-Content-Length': String(pdfBuffer.byteLength),
                'X-Goog-Upload-Header-Content-Type': 'application/pdf',
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ file: { display_name: "document.pdf" } })
            });

            if (initRes.ok) {
              const uploadUrl = initRes.headers.get('x-goog-upload-url');
              if (uploadUrl) {
                const uploadRes = await fetch(uploadUrl, {
                  method: 'POST',
                  headers: {
                    'Content-Length': String(pdfBuffer.byteLength),
                    'X-Goog-Upload-Offset': '0',
                    'X-Goog-Upload-Command': 'upload, finalize'
                  },
                  body: pdfBuffer
                });

                if (uploadRes.ok) {
                  const uploadData = await uploadRes.json();
                  if (uploadData.file && uploadData.file.uri) {
                    parts.push({
                      file_data: {
                        mime_type: "application/pdf",
                        file_uri: uploadData.file.uri
                      }
                    });
                  }
                }
              }
            }
          }
        }
      } catch (pdfErr) {
        console.warn(`PDF download/upload timed out or failed for ${doc.pdf_url}, using title context:`, pdfErr);
      }
    }

    let summaryJson: any = null;
    let usedModel = "";
    const errors: string[] = [];

    for (const model of TARGET_MODELS) {
      const url = `${GEMINI_BASE_URL}/v1beta/models/${model}:generateContent?key=${apiKey}`;
      try {
        const geminiRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: parts
              }
            ],
            generationConfig: {
              responseMimeType: 'application/json'
            }
          })
        });

        if (!geminiRes.ok) {
          const errText = await geminiRes.text();
          errors.push(`[${model} HTTP ${geminiRes.status}: ${errText}]`);
          continue;
        }

        const geminiData = await geminiRes.json();
        const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
          errors.push(`[${model} empty response]`);
          continue;
        }

        const cleanedJsonStr = cleanGeminiResponse(rawText);
        const match = cleanedJsonStr.match(/\{[\s\S]*\}/);
        if (match) {
          summaryJson = JSON.parse(match[0]);
          usedModel = model;
          break;
        }
      } catch (err: any) {
        errors.push(`[${model} Exception: ${err.message}]`);
      }
    }

    if (!summaryJson) {
      throw new Error(`Gemini summary generation failed: ${errors.join(' | ')}`);
    }

    // Save back to Supabase
    await supabaseAdmin
      .from('company_documents')
      .update({
        ai_summary_json: summaryJson,
        ai_status: 'COMPLETED',
        ai_model: usedModel,
        ai_generated_on: new Date().toISOString()
      })
      .eq('attachment_id', targetAttachmentId);

    return new Response(JSON.stringify({
      success: true,
      data: {
        cached: false,
        aiSummary: summaryJson,
        model: usedModel
      },
      aiSummary: summaryJson
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
}));
