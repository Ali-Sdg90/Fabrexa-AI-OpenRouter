# Contributing

Thanks for taking the time to improve Fabrexa AI.

## Before you begin

1. Read the [README](./README.md) and complete the local setup.
2. Use a separate Telegram bot for development when possible.
3. Keep `.env`, bot tokens, private personality prompts, logs, and `chat_memory/` out of commits.

## Development setup

```bash
git clone https://github.com/Ali-Sdg90/Fabrexa-AI.git
cd Fabrexa-AI
npm install
cp .env.example .env
```

Configure `.env` and start Ollama. If image generation is enabled, also start the configured local ComfyUI service. Then run:

```bash
npm run check
npm run dev
```

See the [Project Guide](./docs/PROJECT_GUIDE.md) for the runtime flow and configuration reference.

## Making a change

- Keep each pull request focused on one problem.
- Follow the existing ES module structure and formatting.
- Reuse the configuration module instead of reading environment variables in feature code.
- Avoid committing generated runtime data.
- Update documentation when behavior or configuration changes.

## Validation

Run the complete project check:

```bash
npm run check
```

`npm run check` runs lint, tests, and the local setup check. It needs a configured local environment and running Ollama server. When image generation is available, it also needs the local ComfyUI queue and private checkpoint setting. It does not validate the Telegram token remotely or run a real generation.

The focused test suite covers personalities, conversation parsing, ordered session memory, image preferences, queueing, and model handoff behavior. Manually verify affected Telegram flows, streaming, personality selection, session continuity, and local image generation with a test bot when relevant.

For static website changes, preview `public/` locally:

```bash
python -m http.server 8000 --directory public
```

Check desktop and mobile layouts, keyboard navigation, image loading, and the browser console.

## Documentation

The project intentionally keeps a small documentation set:

- `README.md` introduces the project and contains the installation path.
- `docs/PROJECT_GUIDE.md` explains implementation and configuration details.
- `docs/TROUBLESHOOTING.md` covers common failures.

Prefer improving one of these files instead of adding another overlapping guide.

## Pull requests

Include:

- What changed
- Why the change is needed
- How it was checked
- Any configuration or compatibility impact

Do not include secrets, private conversations, local memory files, or development payload logs.

## License

By contributing, you agree that your contribution will be licensed under the project's [MIT License](./LICENSE).
