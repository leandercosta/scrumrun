# Demo recording script

40-second asciicast that shows a real intake → approve → run → memory
loop. Aim for a public URL you can embed in the README under the pitch.

## Setup

```bash
brew install asciinema             # or: sudo apt install asciinema
asciinema --version                # confirm >= 2.4
```

Optional but recommended: `agg` to convert the `.cast` file to an SVG or
animated GIF for wider viewer support.

## Recording

```bash
# 1. Start a clean throwaway project
mkdir /tmp/scrumrun-demo && cd /tmp/scrumrun-demo
git init -q

# 2. Start recording
asciinema rec -c "zsh" --idle-time-limit 2 --title "ScrumRun in 40 seconds" demo.cast
```

Inside the recording, run these commands slowly (about 5 seconds of
reading between each), typing them yourself so viewers see the cadence:

```bash
scrumrun install --client claude
scrumrun init
scrumrun plan intake "Fix duplicate charges after refresh"
# copy the approval token printed above
scrumrun plan intake --approve <token>
scrumrun plan run --render RUN-001
scrumrun plan run --stats
```

Exit the shell (`exit`) to stop the recording.

## Publishing

```bash
asciinema upload demo.cast         # returns a URL like https://asciinema.org/a/<id>
```

Or, for a self-hosted, browser-friendly SVG:

```bash
agg demo.cast demo.svg
```

## Where to link it

- `README.md`, immediately after the tagline and before "The model".
- LP hero on `scrumrun.dev`, as a small "Watch (40s)" link near the
  `Start with ScrumRun` CTA.

## Script notes

- Keep it under 45 seconds. Cut any dead air on export with
  `asciinema play --idle-time-limit 1`.
- Use a light-on-dark terminal theme that matches the LP palette
  (`#08090a` background, `#c9ff5c` cursor if possible).
- Do not record real secrets — the throwaway project keeps
  `.scrumrun/vault.local.md` empty.
