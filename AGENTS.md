# Working notes

## Commit messages

English, lowercase imperative, subject under 72 characters, then a blank line
and `-` bullets explaining the why. Same voice as the rest of the history.

```
fix: links open on a plain click instead of requiring Ctrl

- linkPlugin drops the Ctrl/Cmd guard, matching Obsidian's live preview
- a plain click used to land the caret inside the link and reveal [[...]]
```

Chinese belongs in `README.zh-CN.md` and in code comments. Commit messages and
release notes stay English so the public history reads as one voice.

## Checks before committing

```
npm run build
env -u ELECTRON_RUN_AS_NODE npx electron . --smoke --user-data-dir=/tmp/notes-smoke-ud
```

`--user-data-dir` is required: a running `Notes.exe` holds the single-instance
lock and the smoke run would exit silently. `--smoke` exits 0 only when every
assertion prints `ok`.

The run rewrites every screenshot in `docs/`. Back the folder up first and copy
back only the images that genuinely changed.

## Packaging

```
npm run desktop:pack
```

Output lands in `dist-app/`. If an old `Notes.exe` there is still running, the
script falls back to `dist-app-2/` — close the app and repack rather than
shipping the `-2` copy. Both directories are gitignored, and `rm -rf` on them
gets intercepted by the sandbox; `git clean -xdff -- dist-app-2` works.
