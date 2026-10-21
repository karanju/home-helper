# 🏠 Homebase — "One household, three ages"
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

### 👪 Families
- Everyone signs in with **Google** (Firebase Auth) and passes the k-ID age gate themselves. Their k-ID `sessionId` is stored on the account, so it follows them across devices.
- A **k-ID verified adult** (k-ID adult verification, confirmed server-side) can create a family and becomes its admin. Admins invite people with one-time links (7-day expiry) and can make other verified adults admins. A family always keeps at least one admin.
- People who join via an invite go through the standard k-ID flow: minors enter a parent's email for consent, and members who want to become admins verify their own age by email from the family panel.
- The family shares one chore list: adults add and assign chores to anyone, teens add chores for themselves, and everyone ticks off their own. Other phones pick up changes within about 15 seconds.
- `/api/ask` takes the age mode from the signed-in user's own k-ID session, not from the request.
- Users, families, invites and chores live in **Firestore**, accessed only by the server (`firestore.rules` denies all browser access).

#### Firebase setup
1. Create a Firebase project (ideally the same Google Cloud project as Cloud Run).
2. **Authentication → Sign-in method**: enable **Google**.
3. **Firestore Database**: create a database (production mode).
4. **Project settings → Your apps**: add a Web app, then copy `apiKey`, `authDomain`, `projectId` and `appId` into `.env` as `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID` and `FIREBASE_APP_ID`.
5. Give the server access to Firestore when running locally. **Never share or commit a service-account key**; each teammate uses their own access:
   - **Recommended (no key file):** get added to the Firebase project (**Project settings → Users and permissions**), then run `gcloud auth application-default login` and `gcloud auth application-default set-quota-project k-id-hackathon`. Leave `GOOGLE_APPLICATION_CREDENTIALS` unset.
   - **Or** generate your own key under **Project settings → Service accounts**, save it **outside the repo**, and point `GOOGLE_APPLICATION_CREDENTIALS` at it.
6. Deploy the rules: `firebase deploy --only firestore:rules` (or paste `firestore.rules` into the console).
7. Hosting: see **Google Cloud Run Deployment** below. No key file is needed there.

Without `FIREBASE_PROJECT_ID` the server still runs: sign-in is disabled, and `?mock-age=` demo mode works with chores kept in the browser.

### 🎭 Live Demo & Judge Fallbacks (Fail-Safe)
If sandbox credentials or Wi-Fi are flaky during the live stage pitch:
1. **URL Query Param**: Add `?mock-age=kid`, `?mock-age=teen`, or `?mock-age=adult` to bypass verification instantly:
   - `http://localhost:8080/?mock-age=kid`
   - `http://localhost:8080/?mock-age=teen`
   - `http://localhost:8080/?mock-age=adult`
2. **On-Screen Demo Switcher**: A floating bar at the bottom allows 1-click mode switching and re-locking during live presentations.

---

## ☁️ Google Cloud Run Deployment

Deploy into the **same Google Cloud project as Firebase (`k-id-hackathon`)**. Cloud Run then reaches Firestore with its own built-in identity, so **no service-account key is uploaded or shared**.

Prerequisites:
- Your Google account is a member of the Firebase project with the **Editor** or **Owner** role (**Firebase console → Project settings → Users and permissions**).
- The project is on the **Blaze (pay-as-you-go)** plan, which Cloud Run requires.

Deploy from the repo root with the Google Cloud CLI:

```bash
# Sign in and select the Firebase project
gcloud auth login
gcloud config set project k-id-hackathon

# Deploy to Cloud Run (builds the Dockerfile automatically; enable the APIs if prompted)
gcloud run deploy home-helper \
  --source . \
  --region us-west1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY="YOUR_GEMINI_API_KEY",KID_SECRET_KEY="YOUR_KID_SECRET_KEY",FIREBASE_API_KEY="...",FIREBASE_AUTH_DOMAIN="k-id-hackathon.firebaseapp.com",FIREBASE_PROJECT_ID="k-id-hackathon",FIREBASE_APP_ID="..."
```

Do **not** set `GOOGLE_APPLICATION_CREDENTIALS` on Cloud Run. The `FIREBASE_*` values are the public web-app config from **Project settings → Your apps**.

After the first deploy:
1. **Authorize the domain for Google sign-in.** In **Firebase console → Authentication → Settings → Authorized domains**, add the service's `*.run.app` host. Without this, the Google popup fails with `auth/unauthorized-domain`.
2. **If Firestore requests fail with `PERMISSION_DENIED`:** in **Google Cloud console → IAM**, give the Cloud Run service account the **Cloud Datastore User** role. That account is shown on the service's **Security** tab, usually `PROJECT_NUMBER-compute@developer.gserviceaccount.com`. Projects whose default service account already has the Editor role don't need this.

Cloud Run will output your public HTTPS service URL, ready for phone and judge demos without your laptop!

---

## 🤖 Dynamic Gemini Flash Architecture

The backend (`server.js`) never hardcodes model names:
1. Queries `GET https://generativelanguage.googleapis.com/v1beta/models?key=GEMINI_API_KEY`
2. Discovers the active Gemini Flash models
3. Employs priority ordering with automatic failover (handles temporary 503 load spikes gracefully without crashing)
4. Applies distinct, calibrated system instructions per age mode to ensure age safety and compliance.

