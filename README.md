# OCRA

OCRA is a small browser-based OCR playground for local vision models. It lets you upload, paste, or drag an image into the page, then sends it to an OpenAI-compatible chat completions endpoint such as LM Studio.

The app is designed for testing handwriting OCR. You can optionally provide a handwriting reference image plus a matching typed transcription so the model can learn the writer's letterforms before reading the target image.

## Features

- Single-file web app: `index.html`
- Upload, drag-and-drop, or paste images from the clipboard
- Works with OpenAI-compatible local endpoints
- Default target: LM Studio at `http://localhost:1234/v1`
- Optional handwriting reference image
- Optional numbered transcription reference
- Streams model output into:
  - Description
  - Extracted Text
- Settings are saved in browser `localStorage`

## Files

- `index.html` — the OCR web app
- `Handwriting-numbered.png` — sample handwriting reference image
- `numbered-machinewritten.txt` — matching typed transcription for the sample reference

## Requirements

- A modern browser
- LM Studio or another OpenAI-compatible server with a vision-capable model
- A model that supports image input

## LM Studio setup

1. Install and open LM Studio.
2. Download a vision-capable model.
3. Start the local server from LM Studio.
4. Make sure the server is available at:

   ```text
   http://localhost:1234/v1
   ```

5. Open `index.html` in your browser.
6. In Settings, set the model name to match the loaded LM Studio model ID.

The app checks `/models` and shows whether it can reach the endpoint and whether the selected model appears in the model list.

## Running the app

Because this is a static app, you can open `index.html` directly in a browser.

For a local web server, from the repo directory run:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

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

- API requests are made directly from the browser to the configured endpoint.
- Do not use a private cloud API key directly in this page unless you understand the security implications.
- For hosted/cloud models, a small backend proxy should be added so secrets are not exposed in browser JavaScript.

## Project status

Early local prototype.
