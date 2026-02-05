# Local Development Setup

This project now supports local API development without Netlify functions!

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure API Key

Create or update `.env.local` with your Gemini API key:

```env
API_PORT=5000
API_KEY=your_actual_gemini_api_key_here
```

Get your API key at: https://ai.google.dev/

### 3. Run Development Server

**Option A: Local API Server (Recommended for local dev)**

```bash
npm run dev:local
```

This runs both:
- Vite dev server on `http://localhost:5173`
- Local API server on `http://localhost:5000`

**Option B: Netlify Dev (if you prefer Netlify functions)**

```bash
npm run dev:netlify
```

Then open `http://localhost:8888`

## How It Works

- **`npm run dev:local`** - Starts Express API server + Vite frontend
- **`npm run api`** - Just the API server (port 5000)
- **`npm run dev`** - Just Vite frontend (port 5173)
- **`npm run build`** - Build for production
- **`npm run preview`** - Preview production build

## API Endpoints

When running locally, the API is available at `http://localhost:5000`:

- **POST** `/generate-image` - Generate images from prompts
  - Takes: `prompt`, `aspectRatio`, `imageSize`, optional image references
  - Returns: Base64-encoded PNG image

- **POST** `/generate-text` - Available only via Netlify (not in local API yet)

- **POST** `/analyze-story` - Available only via Netlify (not in local API yet)

## Switching Between Local and Netlify

The code automatically detects if you're in dev mode (`import.meta.env.DEV`) and:
- Uses `http://localhost:5000` when running locally with `npm run dev:local`
- Uses `/.netlify/functions` when deployed or running with `npm run dev:netlify`

No code changes needed!

## Environment Variables

See `.env.local.example` for all available configuration options.
