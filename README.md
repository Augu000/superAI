<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/14x7WDxFyWagB0Y9As3BUn2dIBcXrHUJE

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env.local` file with your API key:
   ```
   VITE_API_KEY=your_google_ai_api_key_here
   ```
   Get your API key from: https://aistudio.google.com/app/apikey

3. Run the app:
   ```bash
   npm run dev
   ```

## Deploy to Netlify

1. Push your code to GitHub
2. Connect your GitHub repo to Netlify
3. **Important:** Add environment variable in Netlify:
   - Go to Site Settings → Build & Deploy → Environment
   - Click "Add environment variable"
   - Variable name: `VITE_API_KEY`
   - Variable value: Your Google AI API key
   - Save and redeploy

Without the `VITE_API_KEY` environment variable, the app will display a helpful message on the deployed site instructing users to set it up.
