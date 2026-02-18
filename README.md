# Gmail Job Ads Fetcher

A React app that fetches job alert emails from Gmail (LinkedIn, Indeed, Glassdoor), parses job listings, and saves them to a Firebase database for easy browsing and filtering.

## Features

- Connects to Gmail via OAuth to fetch job alert emails
- Parses job listings from LinkedIn, Indeed, and Glassdoor notification emails
- Saves jobs to Firestore with deduplication
- Filter and search jobs by source, type, and keywords
- Optional auto-archiving of processed emails
- Configurable senders, date range, Gmail folder/label filters

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- A [Firebase](https://console.firebase.google.com/) project with Firestore enabled
- A [Google Cloud](https://console.cloud.google.com/) project with Gmail API enabled and OAuth credentials

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/gmail-job-ads-fetching.git
cd gmail-job-ads-fetching
npm install
npm run setup
```

Open the generated `.env` file and fill in your Firebase config and Google OAuth Client ID. See `.env.example` for the required variables.

```bash
npm run dev
```

## Usage

1. Click **Connect Gmail** to sign in with your Google account
2. Click **Fetch Emails** to open the fetch settings modal
3. Configure senders, date range, folder, label, and archive preferences
4. Click **Fetch Emails** in the modal to start processing
5. Browse, filter, and search your parsed job listings


## Browser Extension

The companion [Job Description Scraper](https://github.com/stevenx615/job-scraper-extension) Chrome extension can fetch full job descriptions from LinkedIn, Indeed, and Glassdoor and save them directly to your Firestore database. Descriptions appear on the dashboard in real-time.

- Scrape manually via the extension popup, or enable auto-fetch in Settings > Job Management
- Supports background scraping — no need to stay on the job page

