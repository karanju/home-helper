# 🏠 Home Helper — "One household, three ages"
**Build for Everyone Hackathon (Google + k-ID) — Consumer AI Track**

An age-aware household assistant that safely gates entry via a **k-ID age-verification widget**, dynamically reshaping its interface, capabilities, and Google Gemini AI guardrails to match the user's verified age bracket.

---

## 🎯 The Three Age Modes

| Mode | Age Bracket | UI & Capabilities | AI Guardrails & Features |
| :--- | :--- | :--- | :--- |
| **🧒 Kid Mode** | Under 13 | Playful, colorful checklist UI, Star Points progress bar | **Zero open chat**. Safe chore quests & step-by-step life skills guides. |
| **🧑 Teen Mode** | 13–17 | Culinary & autonomy hub with active kitchen safety checks | **Cooking mentor with guardrails**. Automatic stove/knife/microwave safety warnings. |
| **👤 Adult Mode** | 18+ | Executive household command center | **Full assistant**. Meal planning, family chore delegation, open Gemini chat. |

---

## 🚀 Quick Start (Local Run)

```bash
# 1. Clone / Navigate to project
cd /Users/karanuppin/Documents/Coding/home-helper

# 2. Dependencies are already installed! If needed:
npm install
npm --prefix client install

# 3. Ensure your .env has your GEMINI_API_KEY
# (Already pre-configured)

# 4. Build client & start Express server
npm run build
npm start
```

Visit **`http://localhost:8080`** in your browser.

---

## 🛡️ k-ID Integration & Drop-In Slot

The app uses a strict, modular contract designed for the hackathon:
- **Iframe Slot**: Located in [`client/src/components/LandingPage.jsx`](client/src/components/LandingPage.jsx#L140-L155). When k-ID credentials/snippets arrive tomorrow morning, paste the snippet or set `src={widgetUrl}`.
- **PostMessage Contract**: The app listens for the `Widget.AgeGate.Result` event. When `status: "PASS"` is received with a `sessionId`, the app unlocks and transitions to the verified age mode.
- **Backend Endpoint**: `POST /widget/generate-e2e-url` returns `{ url, sessionId }` and falls back seamlessly to the built-in interactive sandbox.

### 🎭 Live Demo & Judge Fallbacks (Fail-Safe)
If sandbox credentials or Wi-Fi are flaky during the live stage pitch:
1. **URL Query Param**: Add `?mock-age=kid`, `?mock-age=teen`, or `?mock-age=adult` to bypass verification instantly:
   - `http://localhost:8080/?mock-age=kid`
   - `http://localhost:8080/?mock-age=teen`
   - `http://localhost:8080/?mock-age=adult`
2. **On-Screen Demo Switcher**: A floating bar at the bottom allows 1-click mode switching and re-locking during live presentations.

---

## ☁️ Google Cloud Run Deployment

Deploy directly from the root with the Google Cloud CLI:

```bash
# Ensure you are authenticated with gcloud
gcloud auth login
gcloud config set project YOUR_GCP_PROJECT_ID

# Deploy to Cloud Run (builds Dockerfile automatically)
gcloud run deploy home-helper \
  --source . \
  --region us-west1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY="YOUR_GEMINI_API_KEY",KID_SECRET_KEY="YOUR_KID_SECRET_KEY"
```

Cloud Run will output your public HTTPS service URL, ready for phone and judge demos without your laptop!

---

## 🤖 Dynamic Gemini Flash Architecture

The backend (`server.js`) never hardcodes model names:
1. Queries `GET https://generativelanguage.googleapis.com/v1beta/models?key=GEMINI_API_KEY`
2. Discovers the active Gemini Flash models
3. Employs priority ordering with automatic failover (handles temporary 503 load spikes gracefully without crashing)
4. Applies distinct, calibrated system instructions per age mode to ensure age safety and compliance.

