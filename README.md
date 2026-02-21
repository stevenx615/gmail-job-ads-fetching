# Gmail Job Ads Fetcher

A React app that fetches job alert emails from Gmail (LinkedIn, Indeed, Glassdoor), parses job listings, saves them to Firebase, and helps you track applications — with AI-powered badge suggestions and resume tailoring.

## Features

### Job Management
- Connects to Gmail via OAuth to fetch job alert emails
- Parses job listings from LinkedIn, Indeed, and Glassdoor notification emails
- Saves jobs to Firestore
- Bulk actions: mark all read, delete read jobs, clear all
- Export jobs to CSV or JSON

### AI Features
- **Resume Tailoring** — upload a DOCX or paste your resume, then tailor it to any job with one click
  - AI rewrites content to match the job description while preserving your formatting
  - Configurable tone (professional, executive, technical, casual), length, and custom instructions
- **Badge Suggestions** — AI suggests relevant tags (skills, qualifications, responsibilities, benefits) from job descriptions
- Supports Google Gemini, OpenAI (GPT), and Anthropic (Claude)
- AI calls for resume tailoring route through the local backend

### Email Fetching
- Configurable senders, date range, Gmail label/folder filters
- Optional auto-archiving of processed emails

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- [Python](https://www.python.org/) 3.10 or higher (for the backend)
- A [Firebase](https://console.firebase.google.com/) project with Firestore enabled
- A [Google Cloud](https://console.cloud.google.com/) project with Gmail API enabled and OAuth credentials

## Installation

```bash
git clone https://github.com/stevenx615/gmail-job-ads-fetching.git
cd gmail-job-ads-fetching
npm install
npm run setup
```

Open the generated `.env.local` file and fill in your Firebase config and Google OAuth Client ID. See `.env.example` for the required variables.

Install backend dependencies:

```bash
cd backend
pip install -r requirements.txt
```

## Running

```bash
# Terminal 1 — Python backend (required for AI resume tailoring)
cd backend
uvicorn main:app --reload --port 8000

# Terminal 2 — React frontend
npm run dev
```

## Usage

### Fetching Jobs
1. Click **Connect Gmail** to sign in with your Google account
2. Click **Fetch Emails** to open the fetch settings modal
3. Configure senders, date range, folder/label, and archive preferences
4. Click **Fetch Emails** in the modal to start processing
5. Browse, filter, and search your parsed job listings

### Tailoring Your Resume
1. Open **Settings → AI** and configure your AI provider and API key
2. In the sidebar, click **Add Resume** to upload a DOCX file or paste your resume text
3. Select whether to use the uploaded file or pasted text as the active source
4. On any job card, click **Tailor Resume** — the AI rewrites your resume for that role
5. Review the output inline, then download as DOCX or copy to clipboard

### AI Settings
- **Provider** — choose Google Gemini (recommended, no CORS issues), OpenAI, or Anthropic
- **Model** — pick from a list of known models or enter a custom model name
- **Resume Tailoring** — set tone, output length, and custom instructions applied to every tailor request

## Browser Extension

The companion [Job Description Scraper](https://github.com/stevenx615/job-scraper-extension) Chrome extension fetches full job descriptions from LinkedIn, Indeed, and Glassdoor and saves them directly to your Firestore database. Descriptions appear on the dashboard in real-time.

- Scrape manually via the extension popup, or enable auto-fetch in **Settings → Job Management**
- Supports background scraping — no need to stay on the job page
