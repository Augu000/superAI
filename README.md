<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/14x7WDxFyWagB0Y9As3BUn2dIBcXrHUJE

## Run Locally

**Prerequisites:** Node.js and Netlify CLI

1. Install dependencies:
   ```bash
   npm install
   ```

2. Install Netlify CLI (if not already installed):
   ```bash
   npm install -g netlify-cli
   ```

3. Create a `.env` file in the root directory with your API key:
   ```
   API_KEY=your_google_ai_api_key_here
   ```
   Get your API key from: https://aistudio.google.com/app/apikey

4. Run the app with Netlify Dev (this runs both the frontend and functions):
   ```bash
   netlify dev
   ```
   
   Or run just the frontend (functions won't work):
   ```bash
   npm run dev
   ```

## Deploy to Netlify

1. Push your code to GitHub
2. Connect your GitHub repo to Netlify
3. **Important:** Add environment variable in Netlify:
   - Go to Site Settings → Build & Deploy → Environment
   - Click "Add environment variable"
   - Variable name: `API_KEY` (NOT `VITE_API_KEY`)
   - Variable value: Your Google AI API key
   - Save and redeploy

**Note:** The API key is now stored server-side in Netlify Functions, so it's never exposed in the client bundle. This is more secure and prevents the secrets scanning error.
