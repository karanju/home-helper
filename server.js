import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Cache for list of candidate Flash models
let cachedFlashCandidates = [];
let lastCandidatesFetch = 0;
const CANDIDATES_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
let lastWorkingModel = null;

// Helper to retrieve and sort current Flash models dynamically
async function getFlashModelCandidates(apiKey) {
  const now = Date.now();
  if (cachedFlashCandidates.length > 0 && (now - lastCandidatesFetch < CANDIDATES_CACHE_TTL)) {
    return cachedFlashCandidates;
  }

  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const response = await fetch(listUrl);
    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const models = data.models || [];

    // Filter for text generation Flash models
    const flashList = models
      .filter(m => {
        const name = (m.name || '').toLowerCase();
        const supportsGen = (m.supportedGenerationMethods || []).includes('generateContent');
        return supportsGen && name.includes('flash') && !name.includes('tts') && !name.includes('image');
      })
      .map(m => m.name.replace(/^models\//, ''));

    // Priority ordering: latest flash models, falling back to flash-lite-latest and earlier versions
    const preferredOrder = [
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
      'gemini-1.5-flash'
    ];

    flashList.sort((a, b) => {
      const idxA = preferredOrder.indexOf(a);
      const idxB = preferredOrder.indexOf(b);
      const rankA = idxA === -1 ? 999 : idxA;
      const rankB = idxB === -1 ? 999 : idxB;
      return rankA - rankB;
    });

    if (flashList.length > 0) {
      if (lastWorkingModel && flashList.includes(lastWorkingModel)) {
        flashList = [lastWorkingModel, ...flashList.filter(m => m !== lastWorkingModel)];
      }
      cachedFlashCandidates = flashList;
      lastCandidatesFetch = now;
      console.log(`[Gemini] Discovered ${flashList.length} dynamic Flash models. Active target: ${flashList[0]}`);
      return cachedFlashCandidates;
    }
  } catch (err) {
    console.warn(`[Gemini] Error fetching dynamic model list: ${err.message}`);
  }

  return ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-1.5-flash'];
}

// In-memory player accounts and claim store (no database per demo requirements)
const playerAccounts = {
  // Map of sessionId/challengeId -> { type, status, sessionId, challengeId, unlocked, updatedAt }
  records: new Map(),
  latestChallengeId: null,
  latestSessionId: null
};

// 1. Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    service: 'home-helper',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    hasKidSecretKey: Boolean(process.env.KID_SECRET_KEY)
  });
});

// 2. k-ID Server Claim Endpoint
// POST {"claimToken": "..."} to https://kai-api.test.k-id.com/api/v1/client/claim with Authorization: Bearer <KID_SECRET_KEY>
app.post('/api/claim', async (req, res) => {
  try {
    const { claimToken } = req.body || {};
    if (!claimToken) {
      return res.status(400).json({ error: 'claimToken is required' });
    }

    const secretKey = process.env.KID_SECRET_KEY;
    if (!secretKey) {
      console.warn('[k-ID Server] KID_SECRET_KEY is not set in environment.');
      return res.status(503).json({
        error: 'KID_SECRET_KEY is not configured on the server. Please add KID_SECRET_KEY (starts with kgs_test_) to your .env file or Cloud Run environment variables.'
      });
    }

    console.log('[k-ID Server] Claiming age gate token via secret key...');
    const claimRes = await fetch('https://kai-api.test.k-id.com/api/v1/client/claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`
      },
      body: JSON.stringify({ claimToken })
    });

    const claimData = await claimRes.json();
    console.log('[k-ID Server] Claim response status:', claimRes.status, claimData);

    if (!claimRes.ok) {
      return res.status(claimRes.status).json({
        error: 'k-ID claim request failed',
        details: claimData
      });
    }

    // Answer has type ('session' or 'challenge'), status, and sessionId or challengeId
    const { type, status, sessionId, challengeId } = claimData;

    if (challengeId) {
      playerAccounts.latestChallengeId = challengeId;
      playerAccounts.records.set(challengeId, {
        type,
        status,
        challengeId,
        unlocked: false,
        updatedAt: Date.now()
      });
    }

    if (sessionId) {
      playerAccounts.latestSessionId = sessionId;
      playerAccounts.records.set(sessionId, {
        type,
        status,
        sessionId,
        unlocked: status === 'PASS' || status === 'SUCCESS',
        updatedAt: Date.now()
      });
    }

    res.json({
      success: true,
      type,
      status,
      sessionId,
      challengeId
    });
  } catch (err) {
    console.error('[k-ID Server] Error during claim:', err);
    res.status(500).json({ error: 'Internal server error claiming token', details: err.message });
  }
});

// 3. onSession notification & challenge verification endpoint
// When onSession fires in the app, the backend calls GET https://kai-api.test.k-id.com/api/v1/challenge/get-status
app.post('/api/session-sync', async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    const secretKey = process.env.KID_SECRET_KEY;

    if (!secretKey) {
      return res.status(503).json({
        error: 'KID_SECRET_KEY is not configured on the server.'
      });
    }

    const savedChallengeId = playerAccounts.latestChallengeId;

    if (savedChallengeId) {
      console.log(`[k-ID Server] Checking status for saved challengeId: ${savedChallengeId}`);
      const statusRes = await fetch(
        `https://kai-api.test.k-id.com/api/v1/challenge/get-status?challengeId=${encodeURIComponent(savedChallengeId)}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${secretKey}`
          }
        }
      );

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        console.log('[k-ID Server] Challenge get-status response:', statusData);

        // On PASS, save the sessionId it returns and unlock server features
        if (statusData.status === 'PASS' && statusData.sessionId) {
          playerAccounts.records.set(statusData.sessionId, {
            ...statusData,
            unlocked: true,
            updatedAt: Date.now()
          });
          playerAccounts.latestSessionId = statusData.sessionId;
          return res.json({ success: true, status: 'PASS', sessionId: statusData.sessionId });
        }

        // On anything else, keep waiting for the app's next signal
        return res.json({ success: false, status: statusData.status || 'WAITING' });
      }
    }

    // If session was already directly claimed and passed
    if (sessionId && playerAccounts.records.has(sessionId)) {
      const rec = playerAccounts.records.get(sessionId);
      return res.json({ success: true, status: rec.status, sessionId });
    }

    res.json({ success: true, status: 'RECEIVED', sessionId });
  } catch (err) {
    console.error('[k-ID Server] Error during session sync:', err);
    res.status(500).json({ error: 'Internal server error syncing session', details: err.message });
  }
});

// 4. Session info retrieval endpoint
// GET https://kai-api.test.k-id.com/api/v1/session/get?sessionId=...
app.get('/api/session', async (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId query parameter is required' });
    }

    const secretKey = process.env.KID_SECRET_KEY;
    if (!secretKey) {
      return res.status(503).json({ error: 'KID_SECRET_KEY is not configured on the server.' });
    }

    const sessionRes = await fetch(
      `https://kai-api.test.k-id.com/api/v1/session/get?sessionId=${encodeURIComponent(sessionId)}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${secretKey}`
        }
      }
    );

    const sessionData = await sessionRes.json();
    res.status(sessionRes.status).json(sessionData);
  } catch (err) {
    console.error('[k-ID Server] Error retrieving session:', err);
    res.status(500).json({ error: 'Failed to retrieve session from k-ID', details: err.message });
  }
});

// 5. Session deletion endpoint
// POST {"sessionId": "..."} to https://kai-api.test.k-id.com/api/v1/session/delete
app.post('/api/session/delete', async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const secretKey = process.env.KID_SECRET_KEY;
    if (!secretKey) {
      return res.status(503).json({ error: 'KID_SECRET_KEY is not configured on the server.' });
    }

    const deleteRes = await fetch('https://kai-api.test.k-id.com/api/v1/session/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`
      },
      body: JSON.stringify({ sessionId })
    });

    // Remove from in-memory records
    playerAccounts.records.delete(sessionId);
    if (playerAccounts.latestSessionId === sessionId) {
      playerAccounts.latestSessionId = null;
    }

    const deleteData = await deleteRes.json().catch(() => ({}));
    res.json({ success: true, message: 'Session deleted successfully', data: deleteData });
  } catch (err) {
    console.error('[k-ID Server] Error deleting session:', err);
    res.status(500).json({ error: 'Failed to delete session', details: err.message });
  }
});

// 2. k-ID widget URL generation endpoint (Modular Placeholder Slot)
app.post('/widget/generate-e2e-url', async (req, res) => {
  try {
    const { redirectUrl, flowType } = req.body || {};
    
    // Check if custom k-ID credentials / API URL are provided in environment
    const kidApiUrl = process.env.KID_API_URL;
    const kidClientId = process.env.KID_CLIENT_ID;
    const kidClientSecret = process.env.KID_CLIENT_SECRET;

    if (kidApiUrl && kidClientId && kidClientSecret) {
      const kidResponse = await fetch(`${kidApiUrl}/v1/age-gate/e2e-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${kidClientSecret}`,
          'X-Client-Id': kidClientId
        },
        body: JSON.stringify({
          redirect_url: redirectUrl,
          flow: flowType || 'age_gate'
        })
      });

      if (kidResponse.ok) {
        const kidData = await kidResponse.json();
        return res.json(kidData);
      }
    }

    // Default Sandbox / Mock URL for k-ID widget iframe slot
    const mockSessionId = 'kid_sess_' + Math.random().toString(36).substring(2, 10);
    const sandboxUrl = process.env.KID_SANDBOX_URL || `/widget-sandbox.html?session=${mockSessionId}`;

    res.json({
      url: sandboxUrl,
      sessionId: mockSessionId,
      status: 'success',
      isSandbox: true
    });
  } catch (error) {
    console.error('Error in /widget/generate-e2e-url:', error);
    res.status(500).json({ error: 'Failed to generate k-ID widget URL', details: error.message });
  }
});

// System prompts per age mode
const SYSTEM_PROMPTS = {
  kid: `You are "Buddy", a cheerful, encouraging household assistant for kids (ages 6-12).
Rules:
- Keep all answers short (1 to 3 sentences maximum), enthusiastic, and simple.
- Focus ONLY on simple life skills: putting toys away, making the bed, packing a backpack, washing hands.
- NEVER suggest using sharp knives, stoves, ovens, boiling water, electrical tools, or harsh cleaning chemicals.
- If the child asks an open-ended or non-chore question, gently guide them back to kid-friendly household activities or ask an adult.
- Use friendly emojis!`,

  teen: `You are "Chef & Home Guide", a supportive, practical household mentor for teenagers (ages 13-17).
Rules:
- Focus on teen culinary autonomy and household self-reliance: easy cooking, snack prep, basic laundry, meal planning.
- Always include clear SAFETY REMINDERS whenever heat, stoves, ovens, or knives are involved (e.g. "Remember to turn off the burner when done", "Use an oven mitt").
- Maintain healthy boundaries: no dangerous culinary experiments, alcohol, or unsafe kitchen practices.
- Tone: encouraging, step-by-step, realistic, and respectful.`,

  adult: `You are "Home Commander", an expert household management and culinary assistant for adults.
Rules:
- Full capability: advanced recipe ideas, meal planning, inventory management, chore scheduling, time management, and household tips.
- Provide comprehensive, well-structured, clear answers.
- Offer actionable advice, substitutions, and proactive tips.`
};

// 3. Gemini API ask endpoint (gated by k-ID server-side claim verification)
app.post('/api/ask', async (req, res) => {
  try {
    const { message, ageMode = 'adult', sessionId, mockBypass } = req.body;

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ error: 'Message is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY is not configured on the server. Please set GEMINI_API_KEY in .env or Cloud Run environment variables.'
      });
    }

    // k-ID Server-side lock enforcement:
    // Unlock nothing on the server until the claim succeeds
    const secretKey = process.env.KID_SECRET_KEY;
    if (secretKey && !mockBypass && !sessionId?.startsWith('demo_')) {
      let isUnlocked = false;

      if (sessionId && playerAccounts.records.has(sessionId)) {
        const record = playerAccounts.records.get(sessionId);
        if (record.unlocked) {
          isUnlocked = true;
        }
      }

      // If not yet cached, query k-ID session endpoint
      if (!isUnlocked && sessionId) {
        try {
          const verifyRes = await fetch(
            `https://kai-api.test.k-id.com/api/v1/session/get?sessionId=${encodeURIComponent(sessionId)}`,
            {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${secretKey}`
              }
            }
          );

          if (verifyRes.ok) {
            isUnlocked = true;
            playerAccounts.records.set(sessionId, { unlocked: true, updatedAt: Date.now() });
          }
        } catch (err) {
          console.warn('[k-ID Server] Verification lookup error:', err.message);
        }
      }

      if (!isUnlocked) {
        return res.status(403).json({
          error: 'Access locked: This action requires a verified k-ID session with a completed server claim.',
          status: 'LOCKED'
        });
      }
    }

    const validAgeMode = ['kid', 'teen', 'adult'].includes(ageMode) ? ageMode : 'adult';
    const systemPrompt = SYSTEM_PROMPTS[validAgeMode];

    // Discover dynamic Flash models list
    const candidates = await getFlashModelCandidates(apiKey);

    const geminiPayload = {
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: message.trim() }]
        }
      ],
      generationConfig: {
        temperature: validAgeMode === 'kid' ? 0.3 : 0.7,
        maxOutputTokens: validAgeMode === 'kid' ? 150 : 800
      }
    };

    let replyText = null;
    let modelUsed = null;
    let lastError = null;

    // Try candidates in priority order with graceful failover (e.g., if one returns 503 spike or 404)
    for (const model of candidates) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const geminiRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiPayload)
        });

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          replyText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (replyText) {
            modelUsed = model;
            lastWorkingModel = model;
            break;
          }
        } else {
          const errText = await geminiRes.text();
          console.warn(`[Gemini] Candidate ${model} returned ${geminiRes.status}: ${errText.substring(0, 100)}`);
          lastError = `${geminiRes.status}: ${errText}`;
        }
      } catch (err) {
        console.warn(`[Gemini] Candidate ${model} fetch error: ${err.message}`);
        lastError = err.message;
      }
    }

    if (!replyText) {
      return res.status(502).json({
        error: 'All Gemini Flash models are currently busy or unavailable.',
        details: lastError
      });
    }

    res.json({
      reply: replyText,
      ageMode: validAgeMode,
      modelUsed: modelUsed
    });
  } catch (error) {
    console.error('Error in /api/ask:', error);
    res.status(500).json({ error: 'Internal server error processing request', details: error.message });
  }
});

// Serve static frontend files from client/dist
const clientDistPath = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.send(`<h1>Backend running. Run npm run build to compile frontend.</h1>`);
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`🏠 Home Helper server running on http://0.0.0.0:${PORT}`);
  console.log(`🚀 Ready for Cloud Run & Local Demo`);
  console.log(`===============================================`);
});
