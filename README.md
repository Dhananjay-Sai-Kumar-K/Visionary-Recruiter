# 🎤 Visionary Recruiter
### *The Next-Generation AI Interview Coach*

Built for the **Gemini Live Agent Challenge**, Visionary Recruiter is a state-of-the-art multimodal AI coach that sees, hears, and interacts with you in real-time.

![Visionary Recruiter Hero](public/hero_placeholder.png)

## 🚀 The "Beyond Text" Factor
Unlike traditional interview bots, Visionary Recruiter leverages the **Gemini Multimodal Live API (WebSocket)** to:
- **See you**: Analyzes eye contact, hand gestures, and professional demeanor via a live video stream.
- **Hear you & Interrupt**: Supports low-latency audio barge-in, allowing for natural conversation and realistic "stress" follow-up questions.
- **Grade you in real-time**: Uses Function Calling to provide live feedback on your **STAR structure**, confidence, and articulation.

## 🏗️ Architecture
- **Frontend**: React + TypeScript + Vite + Tailwind CSS + Framer Motion
- **AI Brain**: Gemini 2.0 Flash (Multimodal Live API)
- **Engine**: Bidirectional WebSockets for real-time PCM audio and JPEG frame streaming.
- **Deployment**: Google Cloud Run (Frontend + WebSocket Proxy)

## 🛠️ Spin-up Instructions

### Prerequisites
- Node.js (v18+)
- A Google AI Studio API Key ([Get one here](https://aistudio.google.com/app/apikey))

### Local Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/visionary-recruiter.git
   cd visionary-recruiter
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root:
   ```env
   VITE_GEMINI_API_KEY=your_gemini_api_key
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

## 🧠 System Design
The agent uses a persistent WebSocket connection to `generativelanguage.googleapis.com`. 
- **Audio**: 16kHz PCM mono up-link, 24kHz PCM mono down-link.
- **Vision**: 320x240 JPEG frames sent at 0.5 - 1 FPS.
- **Tools**: `update_interview_metrics` function declaration enables Gemini to update the UI state directly based on multimodal inputs.

## 📅 Milestones Reached
- [x] Multimodal Audio/Video Streaming (Live API)
- [x] Adaptive Recruiter Personas
- [x] Real-time STAR Method Analysis
- [x] Premium Glassmorphism UI
- [x] Post-Interview Readiness Dashboard

---
*Created for the Gemini Live Agent Challenge 2026. All rights reserved.*
