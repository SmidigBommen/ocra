# OCRA

OCRA is a browser-based OCR playground for local and external vision models. Upload, paste, or drag an image into the page, then send it to a selected provider for OCR and image description.

It is designed for testing handwriting OCR. You can optionally provide a handwriting reference image plus a matching typed transcription so the model can learn the writer's letterforms before reading the target image.

## Features

- Upload, drag-and-drop, or paste images from the clipboard
- Provider selector for:
  - Local LM Studio / OpenAI-compatible endpoint
  - OpenAI GPT API
  - Anthropic Claude API
- Optional handwriting reference image
- Optional numbered transcription reference
- Streams model output into:
  - Description
  - Labels
  - Extracted Text
- Automatically archives generated notes locally with:
  - creation timestamp/date
  - topic labels
  - OCR text and description
- Exports archive as JSON or CSV for Notion import
- Settings are saved in browser `localStorage`
- External API keys stay server-side via the included local proxy

## Files

- `index.html` — the OCR web app
- `server.js` — local static server and API proxy for OpenAI/Anthropic
- `package.json` — Node start script
- `Handwriting-numbered.png` — sample handwriting reference image
- `numbered-machinewritten.txt` — matching typed transcription for the sample reference

## Requirements

- A modern browser
- Node.js 18+ for the proxy server
- One of:
  - LM Studio or another OpenAI-compatible server with a vision-capable model
  - OpenAI API key and a vision-capable GPT model
  - Anthropic API key and a vision-capable Claude model

## Running the app

From the repo directory:

```bash
npm start
```

Then open:

```text
http://localhost:8080
```

You can still open `index.html` directly for local LM Studio use, but OpenAI and Anthropic integrations require `server.js` so API keys are not exposed in browser JavaScript.

## LM Studio setup

1. Install and open LM Studio.
2. Download a vision-capable model.
3. Start the local server from LM Studio.
4. Make sure the server is available at:

   ```text
   http://localhost:1234/v1
   ```

5. In OCRA Settings, choose **Local — LM Studio / OpenAI-compatible**.
6. Set the model name to match the loaded LM Studio model ID.

The app checks `/models` and shows whether it can reach the endpoint and whether the selected model appears in the model list.

## OpenAI setup

Start the app with your OpenAI API key:

```bash
OPENAI_API_KEY="your-key" npm start
```

In OCRA Settings:

1. Choose **External — OpenAI GPT**.
2. Set a vision-capable model, for example:

   ```text
   gpt-4o
   ```

Requests are sent through the local proxy at `/api/openai/chat/completions`.

## Anthropic Claude setup

Start the app with your Anthropic API key:

```bash
ANTHROPIC_API_KEY="your-key" npm start
```

In OCRA Settings:

1. Choose **External — Anthropic Claude**.
2. Confirm **Request target** shows `/api/anthropic/chat/completions`.
3. Set a vision-capable model, for example:

   ```text
   claude-opus-4-6
   ```

Requests are sent through the local proxy at `/api/anthropic/chat/completions`. The proxy converts OCRA's OpenAI-style image messages into Anthropic's Messages API format.

Use Anthropic API model IDs, not display names. Known useful options include:

- `claude-opus-4-6`
- `claude-sonnet-4-5-20250929`
- `claude-opus-4-1-20250805`

The proxy also accepts a few common friendly aliases such as `Opus 4.6` and `Sonnet 4.5` and maps them to API IDs.

You can also create a local `.env` file instead of exporting keys:

```text
ANTHROPIC_API_KEY=your-key
OPENAI_API_KEY=your-key
```

`.env` is ignored by git.

## Note archive and Notion

Each successful analysis is saved to a local browser archive. The archive entry contains:

- Title/source image name
- Created timestamp and created date
- Topic labels
- Description
- Extracted text
- Provider and model

Use **Export CSV for Notion** to download `ocra-notion-import.csv`, then import that CSV into a Notion database. Suggested Notion property mapping:

- `Title` → Title
- `Created Date` → Date
- `Labels` → Multi-select
- `Description` → Text
- `Extracted Text` → Text
- `Provider` → Select
- `Model` → Text

### Direct Notion sync

OCRA can also sync archived notes directly to a Notion database through the included local server.

Add these to `.env`:

```text
NOTION_API_KEY=secret_your_notion_integration_key
NOTION_DATABASE_ID=your_database_id
```

Then restart:

```bash
npm start
```

In Notion, make sure your integration has access to the target database. The app will create one Notion page per archived note. It auto-detects the database title property and fills these properties when they exist:

- `Created Date` — Date
- `Labels` — Multi-select
- `Description` — Text
- `Provider` — Select or Text
- `Model` — Text

The full OCR transcription is added as page content under an **Extracted Text** heading.

The Notion MCP URL may be useful for agent workflows later; the current app integration uses Notion's HTTP API from `server.js`.

## Using the handwriting reference

1. Open the **Handwriting reference** section.
2. Add a handwriting reference image.
3. Add or load the matching transcription text.
4. Use numbered lines when possible, for example:

   ```text
   1 First handwritten line
   2 Second handwritten line
   3 Third handwritten line
   ```

5. Upload or paste the target image and click **Analyze**.

The reference is sent before the target image and instructed to be used only as handwriting guidance, not as content to transcribe.

## Notes

- Local LM Studio requests go directly from the browser to the configured endpoint.
- OpenAI and Anthropic requests go through `server.js` so API keys remain in environment variables.
- If Claude still appears to use the local model, reload `http://localhost:8080`, choose **External — Anthropic Claude**, and check that **Request target** is `/api/anthropic/chat/completions`.
- Do not put private cloud API keys directly into browser code.

## Project status

Early local prototype.
