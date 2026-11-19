# Fabrexa AI

**AI conversations that remember and become images.**

Fabrexa AI is a self-hosted Telegram bot for personality-driven conversations, session continuity, and locally generated images. Ollama streams the character's reply, ComfyUI renders the latest scene when images are enabled, and ordered memory carries important state into later turns.

## What it does

- Streams personality-driven replies into the Telegram conversation
- Pairs character prompts with separate visual appearance references
- Generates conversation-aware images through a local ComfyUI checkpoint
- Keeps recent conversation context and ordered continuity memory inside each session
- Includes four ready-to-use personalities and supports custom ones
- Supports compact or larger, more capable local models according to the host hardware
- Provides private owner-only access by default

Telegram carries messages, replies, and delivered photos between the user and bot. Text inference, image generation, personality prompts, conversations, and session-memory files remain on the machine hosting Fabrexa.

## Requirements

- Node.js 22 or newer
- Ollama
- ComfyUI when local image generation is enabled
- A Telegram bot token
- A numeric Telegram user ID when private mode is enabled
- A public Telegram username for private-mode access requests

## Basic setup

```bash
git clone https://github.com/Ali-Sdg90/Fabrexa-AI.git
cd Fabrexa-AI
npm install
ollama pull gemma3:12b
```

Copy `.env.example` to `.env`, then add the Telegram token, numeric owner ID, and public owner username. In private mode, the username is shown to users who want to request access. To enable local images, also run ComfyUI and set `COMFYUI_CHECKPOINT_NAME`; for a text-only setup, set `IMAGE_GENERATION_AVAILABLE=false`. The included `Friendly` personality works without additional setup:

```bash
npm run check
npm start
```

## Documentation

- [Source and README](https://github.com/Ali-Sdg90/Fabrexa-AI)
- [Project guide](https://github.com/Ali-Sdg90/Fabrexa-AI/blob/main/docs/PROJECT_GUIDE.md)
- [Troubleshooting](https://github.com/Ali-Sdg90/Fabrexa-AI/blob/main/docs/TROUBLESHOOTING.md)
- [LLM-readable map](./llms.txt)

Fabrexa AI was designed and developed by Ali Sadeghi and is licensed under the MIT License.
