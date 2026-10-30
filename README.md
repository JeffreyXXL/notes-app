# Notes · Desktop

**English** · [简体中文](README.zh-CN.md)

> **Download**: [latest release · Windows x64](https://github.com/JeffreyXXL/notes-app/releases/latest)
> — unzip and double-click `Notes.exe`. No Node, no command line, no network.

A three-pane Markdown note app. The front end is **Vite + TypeScript + CodeMirror 6** (no framework, hand-written DOM), and there are two desktop shells sharing the same front end, the same command contract, and the same vault directory:

| Shell | Size | Build requirements | Status |
| --- | --- | --- | --- |
| **Electron** | 278 MB packaged | None — `npm install` and go | ✅ Packaged and verified running |
| **Tauri 2** | ~8 MB | Rust + Windows 10/11 SDK | Source complete, not yet compiled |

Electron was picked because it needs no compiler: install dependencies and you get a window. The Tauri shell stays in the repo so it can be switched to whenever a machine has Rust — notes and settings are fully interchangeable.

The interface: left pane for navigation (folders / tags / groups, plus Archive, Hidden and Trash), middle pane for the card list (swipe actions, click `···` for the menu, drag to reorder), right pane for continuous editing with live-rendered Markdown and images.

The name in the top-left corner, the color scheme, the font and password lock are all configurable in Settings. The lock screen is a password prompt drawn over the UI — not file encryption.

The window is frameless: the system title bar is gone and the `— □ ✕` buttons at top right are drawn by the app. Drag the window by the empty strip along the top of the three panes; double-click that strip to maximize/restore.

![Desktop window](docs/desktop-window.png)

<sub>Screenshots are captured from a real Electron window (`npm run desktop:shots` generates them), not from a browser preview.
The notes in them are **fictional demo data** — product notes, reading notes, a shopping list. No real project names.</sub>

Two more (dark theme, multi-image cards):

![Dark theme](docs/scheme-graphite-dark.png)

![Multi-image cards](docs/card-multi.png)

---

## 0. Getting started

### Fastest: double-click the prebuilt exe

```
dist-app\Notes-win32-x64\Notes.exe
```

That's it. No Node, no command line, no network, no browser tab.

### Run from source (no compiler needed)

```powershell
# quote the path if it contains spaces
cd notes-app
npm install
npm run desktop
```

An independent window opens — no address bar, no browser chrome. On first launch it writes 10 sample notes into `%APPDATA%\com.notesapp.desktop\vault`.

### Build a double-clickable exe

```bash
npm run desktop:pack
```

The output lands in `dist-app\Notes-win32-x64\Notes.exe` (278 MB measured — 181 MB of that is the Electron runtime, 10.4 MB is your code and fonts).
Double-click and go: no Node dependency, no network, no listening port. The whole `Notes-win32-x64` folder can be copied to another Windows machine and used as-is.

> If an older `Notes.exe` is still running during packaging, the script will not overwrite it (that corrupts the file).
> It writes to `dist-app-2\` instead and says so in the console. Close the old window and re-pack to get back to `dist-app\`.

> To put it on the desktop: right-click `Notes.exe` → Send to → Desktop (create shortcut).
> Don't copy `Notes.exe` on its own — the `.dll` files and the `resources\` folder next to it are required.

### Development (browser hot reload — fastest iteration)

```bash
npm run dev
```

Open `http://localhost:1420`. Data lives in localStorage; every feature works, it just doesn't touch real files.

> `1420` is the **Vite dev server** (bound to localhost, serving the page and hot reload) — not a backend.
> `npm run desktop` doesn't need it at all: front-end assets are bundled into the asar and Electron reads them
> through a custom `app://` protocol. No network, no port, no database process.

### Self-check

```bash
npm run test:io        # 12 file I/O unit tests (path traversal, atomic writes, empty-dir cleanup, image writes…)
npm run desktop:smoke  # headless real window: checks DOM / bridge / disk, and takes screenshots
npm run desktop:shots  # same, but against a fictional demo vault — this is what generates the README images
```

> **The screenshots use a demo vault, not your notes.** `--demo` points the vault at a set of
> invented notes in a temp directory (product notes, reading notes, a shopping list, a travel plan…).
> No real project or client names. Screenshots used to be taken against a copy of the real vault,
> which meant the sidebar was full of client folder names and the cards held site photos —
> shipping those with the repo is a leak, so they were replaced entirely.

`desktop:smoke` really clicks through the app before exiting: a real mouse click on the settings panel's close button and the right-pane toggle → click a card → screenshot → click a table to edit → click elsewhere to re-render → click bold in the quick bar then undo → click `···` to open the action bar → switch through three color schemes × light/dark, one screenshot each → multi-select tags → rename a folder (and rename it back) → pin badge → drag to reorder (then drag back) → image rendering → single click only selects → tap the 50% preset → drag the handle wider → shrink to 25% → double-click into source → paste an image to disk → card preview (no blank cards + thumbnails + CRLF excerpt) → code block highlighting + click does nothing + double-click into source → click an internal link → todo resolutions → card path shortens level by level → drag-reorder folders → old folder is reclaimed after rename → file renames when the title changes → placeholder filenames aligned to titles on startup → right-click hide / unhide from Hidden → rename the app → card image on its own row + multi-image layout → set password / lock / wrong password rejected / right password accepted. Screenshots land in `docs/`:

| File | Contents |
| --- | --- |
| `scheme-{cream,graphite,paper}-{light,dark}.png` | One per color scheme × light/dark |
| `settings-appearance.png` | Settings: name / scheme / light-dark / security |
| `meta-tags.png` | Tag multi-select in the "organize" sheet |
| `left-rename.png` | Inline rename field in the left pane |
| `desktop-image.png` | Image in the body (full window) |
| `image-resize.png` | Selected image: outline + size toolbar + drag handle |
| `code-block.png` | Code block: language label + syntax colors + copy button |
| `note-links.png` | Internal links + todo resolutions |
| `card-multi.png` | Multi-image card preview (three different aspect ratios sharing a row) |
| `lock-screen.png` | Password lock screen |
| `desktop-window.png` / `tag-colors.png` | Default UI / tag colors |

> `zoom-*.png` (detail crops) go through `capturePage` region capture and are written to the system temp directory instead of `docs/`.

A few assertions worth keeping:

| Output | Meaning |
| --- | --- |
| `blank=… drag=none` | The placeholder element must not be a window drag region |
| `window=1570x960` | Default window size (shrinks proportionally on small screens) |
| `setClose … openAfter=0` / `setSwitch … before=true after=false` | The settings panel's right half and the toggles really respond to clicks |
| `tagEditor=8->10` | Two tags can be added in a row |
| `rename=技术 -> 技术-改` + `renameBack=技术` | Folder rename really moved files, and it can be undone |
| `pinFlag=flags1 cards1 firstPinned=1` | A pinned note has a badge and sorts first |
| `orderDrag=changed` + `orderBack=restored` | Drag reordering works and is reversible |
| `img=1/1/600x220 broken=0` | The image really decoded to pixels (600×220 is the test SVG's intrinsic size) |
| `imgPick=1/0 selected=1 tools=1 grip=1` | **A single click only selects**: the image is still there (1), it did not fall back to source (0), toolbar and handle are shown |
| `imgBox={"tools":1368,"frame":1376}` | The toolbar sits 8px to the right of the image, not floating at the column edge; `overflow:0` means buttons don't burst out of it |
| `imgHalf={"w":365,"box":730}` | The 50% preset gives exactly half the text column width |
| `imgDrag={"before":365,"after":465}` | Dragging the handle 100px wider actually changes the width on release |
| `imgNarrow={"fw":183,"tw":263,"over":40}` | When the image is narrower than the toolbar, the toolbar overflows centered (40 = (263−183)/2) |
| `imgResize={half,drag,mdHalf,mdDrag,narrow}` | Preset / drag / percent / pixels — all written back into the `.md` on disk |
| `preview=cards4 blank0 thumbs1` | Card previews: no blank cards, at least one thumbnail |
| `crlf="这一行是正文…"` | Excerpts can be extracted from CRLF files too (this one guards a real bug) |
| `imgEdit=0/1` | Only a **double-click** on an image reverts to the source line |
| `imgPasteFile=… size=70` | A pasted image really lands on disk |
| `tagTints=8/8` / `grip=open1 close0` | Tag colors don't collide / `···` opens and closes on click |
| `code={"blocks":2,"lang":"ts","kw":3,"str":1,"com":1,"fn":1,"tables":0}` | Both code blocks render, the language label is right, keywords / strings / comments / function names are colored; **a table inside a code block is not treated as a table** |
| `codeClick=2/0` | **A single click on a code block does nothing**: both blocks remain, zero fence lines exposed |
| `codeEdit=1/2` | Double-click reverts to source (one block fewer, two fence lines more) |
| `link={"wiki":2,"note":1,"add":1}` | Two internal links / one todo resolution / one `＋` button |
| `linkJump="图片测试"` | Clicking `[[图片测试]]` really navigates there (verified via the selected card in the middle pane) |
| `cardPath all="技术 / 子目录" lv1="子目录" lv2=""` | The card path shortens level by level and disappears when there is nothing below |
| `leftOrder=技术,收集箱 -> 收集箱,技术 saved=["收集箱",…]` | Folder drag reordering, persisted to the settings file |
| `prune oldGone=true newThere=true` | After a rename the old folder (including empty subfolders) is really gone |
| `titleRename title="代Z码块测试" hasZ=true oldGone=true` | Changing the H1 really renames the file; the old name is gone |
| `placeholderRename old=false new=true` | On startup `占位符/无标题.md` becomes `占位符改名测试.md` from its heading |
| `hide={"hasRow":true,"hideBefore":17,"hideAfter":16,"hiddenCnt":"1","inHidden":1,"hiddenAfter":"0"}` | The context menu has "hide"; hiding removes one row, bumps the sidebar count; the note is found under Hidden; unhiding zeroes the count |
| `appName brand="我的笔记" docTitle="我的笔记"` | Renaming updates both the top-left label and the window title |
| `thumbRow={"disp":"block","w":139,"cardW":313,"below":8}` | The card image is block-level and starts a new row below the excerpt |
| `thumbUniform sameH=true h=[96] fitOk=true modes=multi:2,solo:1,multi:2,solo:1,multi:3,multi:2` | **All card thumbnails are the same height**; a single image uses `contain` (no crop), multiple images use `cover` and share the same width within a card |
| `figs=[{"total":2,"shown":2,…,"gap":6},…,{"total":4,"shown":3,"more":"+1"}]` | Cards with two or more images really lay out side by side; at most 3 per row, 6px gaps, no overflow; the 4th onward collapse into `+N` |
| `lock={"enabled":true,"shown":true,"stillLocked":true,"errText":"密码不对","unlocked":true}` | Enabling the password flips the toggle; "lock now" really covers the UI; a wrong password is rejected with a message; the right one gets through |
| `railRegion=no-drag coveredBy=""` | The rail buttons shown after collapsing a pane are carved out of the window drag region — otherwise a real click drags the window instead of hitting the button |

The final `verdict={...}` line prints all of those booleans — if one goes red, the name tells you which.

> Smoke mode is **fully isolated** and will not dirty your real notes:
> - Vault: on startup `appData/vault` is `cpSync`'d into `temp/notes-smoke-vault`; every write lands on the copy (`smokeVault()` in `vaultRoot()`)
> - Settings file: redirected to `temp/notes-smoke-settings.json`
>
> To run against another directory, `NOTES_APP_VAULT` takes precedence over both.
>
> This was learned the hard way: early smoke runs hit the real vault directly, picking real notes to click, drag and rename,
> and one run would stomp the `mtime` / `updated` of whatever you were writing. Now it copies first — the assertions still
> run against identical data and not a byte changes on your side.

### Day-to-day usage

**Writing notes**
- The `新建笔记` (New note) button at the top right of the middle pane — or `Ctrl/Cmd + N` — starts a note. The title is the first `# Heading` line of the body.
- Typing `# `, `- `, `- [ ] `, `> `, `**bold**`, `` `code` `` immediately renders into the corresponding style.
- When the cursor sits on a line, that line reveals its Markdown source so you can edit it; move away and it renders again.
- **Enter continues the format.** At the end of a task line (`- [ ] `), a list item (`- ` / `1. `) or a quote (`> `),
  Enter starts the next line with the same marker: ordered lists increment, new todos always start unchecked, indentation
  is carried over. Press Enter again on an empty item and the marker is dropped, so you get a plain paragraph back
  instead of a list you can't escape. Inside a fenced code block Enter is just a newline.
- **A new note inherits where you are.** With a folder selected in the left pane, the note is created in that folder;
  with a tag selected, it gets that tag. It never vanishes from the list you just clicked `新建笔记` in.
- To turn this off: Settings → Editor → toggle it off.

**Bottom quick bar**
- A floating toolbar sits at the bottom of the editor so you don't have to remember syntax. It floats over the text rather than taking up layout space (the body already leaves room at the bottom).
- The left group is inline formatting: bold / italic / strikethrough / inline code / link.
- The right group is block elements: image / heading / list / todo / quote / table / divider.
- With a selection, the format wraps the selection; clicking the same button again removes it. With no selection, it inserts a pair of markers and puts the cursor in between.
- The heading button cycles: body → `##` → `###` → body.
- The table button inserts a 2×3 template you can edit directly.

**Images**
- Three entry points: the image button in the quick bar (opens a file picker, multi-select works), `Ctrl/Cmd + V` to paste a screenshot, or drag an image file straight into the body.
- Images are stored in `_assets/` at the vault root, named `timestamp + random string`, so they never collide.
- The body stores a **vault-absolute path**: `![diagram](_assets/20261026-153022-a1b2c3.png)`.
  Moving the note between folders never breaks it — that's why relative paths aren't used.
- An image must be **alone on its line** to render; one embedded mid-sentence stays as Markdown source.
- **A single click only selects** the image — it does not flip to text. Once selected, an outline appears around it,
  a size toolbar floats at the top right and a drag handle appears at the bottom right. Click elsewhere to deselect.
- **Double-clicking** the image puts the cursor in and reverts it to `![alt](path)` source, for editing the path or alt text.
  The "edit" button at the far right of the toolbar does the same thing.
- If the file was deleted or the path is wrong, you get a "找不到图片：xxx" (image not found) line instead of a broken-image icon.
- Hand-written relative paths (`./img.png`) also work: they resolve against the note's folder first, then the vault root.

**Resizing images**
- With the image selected, the toolbar offers `25% / 50% / 75% / 100%` presets. Percentages are **relative to the text column width**,
  so the image shrinks with the window instead of overflowing. "Original" returns to the image's intrinsic pixel size.
- Or **drag the small hatched square at the bottom right** to whatever width you want. Dragging only updates styles; the file is
  written on release, which is what keeps it responsive instead of stuttering.
- The width is stored in braces at the end of the Markdown line:

  ```markdown
  ![diagram](_assets/20261026-153022-a1b2c3.png){width=320}
  ![diagram](_assets/20261026-153022-a1b2c3.png){width=50%}
  ```

  This is plain text; other Markdown editors will show it as a stray line of characters (the image itself is unaffected).
  Other attributes inside the braces (`height` and so on) are preserved as-is — only `width` is touched.
- Dragging writes pixels, presets write percentages. They mix freely and both are understood next time the note opens.

**Tables**
- Standard Markdown tables render as real tables: one rounded outer border, a tinted header row, a very light rule between rows
  and between columns, no zebra striping.
- Alignment syntax works: `:---` left, `:---:` center, `---:` right.
- Cells support `` `code` ``, **bold**, *italic*, ~~strikethrough~~ and links.
- **A single click on the table** puts the cursor in and the whole block reverts to Markdown source; click elsewhere to render again.
- Text inside a table can be drag-selected and copied (dragging does not trigger editing).

**Code blocks**
- Fenced code blocks (```` ```ts ```` / `~~~`) render as one block: a small language label on top and a "copy" button at the top right (shown on hover).
- **Syntax highlighting by language**: comments, strings, numbers, keywords, types, function names and punctuation each get a color.
  It understands `js/ts/jsx`, `json`, `py`, `sh/bash`, `html/xml`, `css/scss`, `sql`, `go`, `rust`, `java/c/c++/c#`, `yaml`, `toml`,
  plus aliases (`typescript`, `python`, `bash`, `rs`, `c++`…). Unknown languages are shown verbatim, no error.
- Highlight colors come from CSS variables (`--hl-kw` / `--hl-str` / …), so switching scheme or light/dark needs no recomputation.
- **Double-clicking a code block** puts the cursor in and reverts the block to source; click elsewhere to render again — the same interaction as images.
  **A single click does nothing**: it used to explode into source, so scrolling, selecting a word to copy, or a slightly-off click
  all required clicking back. Hovering shows a "双击编辑" (double-click to edit) hint.
- A `| a | b |` inside a code block is not mistaken for a table, and `![x](y)` is not mistaken for an image (the whole block is code; nothing inside is parsed).
- The old approach was "hide the two fence lines, tint every line in between" — but the hidden fences still participated in selection
  arithmetic, so dragging a selection across a code block painted it in empty space and looked misaligned. Now the block is a single
  widget and the problem is gone.

**Linking to another note**
- Both forms are recognized, and both navigate on click:

  ```markdown
  see [[产品方向思考]]                     ← by title, easiest
  see [last conclusion](工作/产品/方向.md)  ← by path, most precise
  ```

- `[[title]]` matches in stages: relative to the current note's folder → vault path → same filename → same title → title contains
  (only if the result is unique). So after a note is renamed, `[[old title]]` still finds it.
- In `[text](path.md)` the path can be relative (`./a.md`, `../x/a.md`) or vault-relative.
- `[text](https://…)` external links open in the system browser, never a new window inside the app.
- If the target lives in another folder, the archive or the trash, the view switches to one where it's visible — you never get
  "it opened but I can't see it".
- When nothing matches you get a light toast ("没有找到「xxx」这篇笔记" — no such note), not silence.
- The quick bar has two link buttons: one inserts an external link `[text](url)`, one inserts an internal link `[[note name]]`.
- To edit the link text: click elsewhere on the line to put the cursor in (the line reverts to source), or move there with arrow keys.

**Todo resolutions**
- Each todo can carry a "how this gets solved" note after an arrow:

  ```markdown
  - [ ] login fails intermittently → replace the old token check, see [[login rework]]
  - [x] export is too slow → switch to streaming, see https://example.com/stream
  ```

- The arrow renders in a muted color and the resolution in small grey text, clearly separated from the todo itself; `[[notes]]` inside it are clickable.
- Checking the todo strikes through only up to the arrow — the resolution isn't part of "the todo".
- A todo without a resolution shows a faint `＋` at the end of the line: it appears on hover, and clicking it inserts `→ ` and puts the cursor after it.
- `->` works too; you don't have to type the full-width arrow.

**Card previews**
- Each card in the middle pane shows "an excerpt + thumbnails from the body". Excerpts are at most two lines, truncated beyond that.
- The excerpt is **not** just the first line: it skips the heading (already shown above the card), skips the table's `| --- |` separator row,
  skips code fences and skips images that sit alone on a line, then walks paragraphs in order until it has enough characters.
- If there is **no ordinary paragraph** it degrades step by step rather than showing nothing:
  table → first data row (`产品 · 需求与方向 · 自动分配`); code block → first line of code; images only → thumbnails only.
- Thumbnails **start a new row** and have a **fixed 96px height**, so a column of cards has uniformly tall images. Two cases:
  - **One image**: width follows the image's own aspect ratio (capped at the card width), no crop and no empty frame.
  - **Two or more**: they share one row evenly, at most **3** visible, the rest collapse into `+N` at the bottom right.
    Multiple images are cropped to the same box (`object-fit: cover`), so images within one card are always the same size —
    note images range from 1:1 to 3:1, and honoring each ratio produced "one image eats the whole row and the rest get squeezed out".
  - When a note is all images and no text, the thumbnails move to the top with no blank gap above them.
  - Early on this was a 54×54 square pinned to the right, which squeezed long excerpts into a narrow strip. Then it became
    "100% wide + 96 tall + `object-fit: cover`", which cropped near-square screenshots by two thirds so they looked zoomed,
    while wide images stayed almost intact — a column read as "every image is a different size". Single images keep a fixed
    height only; multiple images share the row evenly. That's the result of two rounds of getting it wrong.
- `![](x.png)` inside a code block doesn't count (fenced blocks are stripped line by line before collecting images), and the same
  image referenced twice counts once.
- If an image was deleted or the path is wrong the thumbnail simply disappears — no broken icon. If a whole row fails, the row is removed.
- If there really is neither text nor image, the card says "空白笔记" (empty note) so you know it's empty rather than unrendered.
- Below the title there is a **folder path** row showing "the levels you haven't drilled into yet":

| Current selection | Shown on the card |
| --- | --- |
| All notes | Full path `技术 / 前端 / React` |
| First-level folder `技术` | `前端 / React` |
| Second-level folder `技术/前端` | `React` |
| The note sits at this level (nothing deeper) | The whole row is hidden |

  So the deeper you drill, the shorter this row gets, and it disappears naturally — no `技术 / 技术 / 技术` nonsense.

**Reordering**
- The middle list **does not re-sort itself by edit time**. Writing never makes cards jump around.
- To move something, **press and drag the card up or down**: a blue insertion line appears and the card drops where you release.
  The order is written into `order` in the front matter and survives a restart.
- Pinned notes always sit in the top group and cannot be dragged out of it.
- New notes go to the front.
- Drag and swipe share one pointer gesture: **vertical intent** (moving up/down) reorders, **horizontal intent** (moving left/right) opens the swipe actions.

**Folders and tags in the left pane can be reordered too**
- Press and drag a folder row up or down to move it; an insertion line marks the drop point. **Only within the same level**
  (cross-level drags would make the tree structure nonsensical).
- The order is stored as `folderOrder` (an array of paths) in the settings file and survives a restart.
- New folders that were never ordered fall to the end, sorted by name — you never have to go back and number them.
- Same for the tag list (`tagOrder`): by default most-used first, and after one drag it follows your order.
- The pencil and expand arrows don't participate in dragging; finishing a drag doesn't accidentally change the filter.

**Todos**
- `- [ ] something` becomes a checkbox; clicking it checks it and strikes through the text.
- The checked state is written straight back to the file (`- [x] something`).
- Each can carry a `→ resolution`, see "Todo resolutions" above.

**Finding things**
- `Ctrl/Cmd + K` focuses the search box and searches as you type. Title, body, tags and folder all participate; title hits rank first.
- Matches are highlighted both on the cards and in the body, which scrolls to the first hit.
- The top right shows "N 处匹配" (N matches); the badge is hidden when there are none.

**Organizing**
- Swipe a card left (mouse drag works too) to reveal the action bar: pin / archive / organize / hide / delete.
- On desktop it's easier to **click the `···` at the card's top right** (click again to collapse) or **right-click the card** for a menu.
- "整理" (organize) lets you change folder and tags. Changing the folder really moves the file to that directory.
- **Tags are multi-select**: selected ones appear as colored chips (click `×` to remove), with pale chips of existing tags below —
  click to add, repeatedly. Typing a new tag and pressing Enter also works (the tag doesn't need to exist). Backspace on an empty input
  removes the last one.
- Which buttons the action bar shows is configurable in Settings → Interaction → swipe actions (at least one must stay on).

**Hiding**
- Right-click a note → "隐藏这篇笔记" (hide this note), or the "hide" action in the swipe bar / `···` menu.
- Once hidden it appears in no list, no search, **and doesn't count toward the folder and tag totals in the sidebar** — it's simply gone.
- The way back is at the bottom of the left pane: **"已隐藏"** (Hidden), next to Archive and Trash, with a count after it.
- Clicking "取消隐藏" (unhide) inside Hidden returns it to its original folder, nothing else changed.
- The difference from Archive is intent: archiving means "this is done", hiding means "I don't want to see it right now". They don't affect each other.
- State lives in `hidden: true` in the front matter. **The line is only written when hidden**, so normal notes never gain an extra line.
- Hiding also clears the pin — otherwise it would still sort first inside Hidden, which is odd.

**Password lock**
- Settings → Security → "密码锁定" (password lock) toggle. The first time you enable it, a dialog asks you to set a password
  (at least 4 characters, entered twice).
- Once on, **every launch requires the password**. "立即锁定" (lock now) locks manually.
- A wrong password shakes and says "密码不对" (wrong password) without revealing which part was wrong.
- Change it: Settings → Security → "设置密码" (set password).
- Forgot it: quit the app, open the settings file in Notepad, set `lockHash` to an empty string and `lockEnabled` to `false`.
  The settings file sits next to the "vault location" shown at the bottom of the settings panel — same folder, `settings.json`.
- **This is a lock to keep people out, not encryption.** Notes stay plaintext `.md` on disk; anyone who can read the files can bypass it.
  Its purpose is "don't let someone flip through my notes while I'm away from my desk".
- Only a digest is stored, never the password, and the digest carries an algorithm prefix (`s1:` = SHA-256, `f1:` = fallback used
  when WebCrypto is unavailable).

**Renaming the app name**
- Settings → Appearance → "名字" (name). Applies immediately, including the window title.
- At most 12 characters; longer names are ellipsized so they never push the collapse button out of the way.
- Clearing it counts as no change and falls back to the default "笔记".

**Renaming folders**
- Hover a folder row in the left pane and a pencil appears at the end; click it to rename in place, Enter to confirm, Esc to cancel.
- Renaming **really renames the folder on disk**; every note beneath it (including subfolders) moves along.
- Afterwards **the old folder is reclaimed**: leftover empty subfolders are removed too (only empty ones — anything with files stops the process).
  It used to leave an empty husk behind, which looked like "the rename didn't work".
- The rename also updates in-memory paths, the currently selected note, the folder's expanded state and the active filter.
- If the target name already exists, a number is appended (`技术 2`) rather than merging into an existing folder.
- Why a pencil button instead of double-clicking the row: a single click changes the filter and repaints the whole tree, so the row
  element is replaced and the second click lands on a new element — `dblclick` never fires.

**Renaming tags**
- Tag rows have the same pencil; click it to rename in place.
- Renaming **updates that tag in every note** (deduplicated, written back to each front matter), and the tag order list plus the
  current tag filter follow along.
- Tag renaming never touches files, only `tags` in the front matter.

**Changing the title renames the file**
- After the first `# Heading` in the body changes (about 1.4 seconds after you stop typing), the filename is renamed to match.
  That's the most natural shape for a plain-text note app: the name you see in the file list is the title.
- Notes without a `# Heading` don't trigger it (the filename *is* the title then), so there's no rename-back-and-forth loop.
- The rename also rewrites **links pointing at it from other notes**: `[[old title]]` → `[[new title]]`, `(old/path.md)` → `(new/path.md)`.
- Filename sanitization matches new-note creation (Windows illegal characters, reserved names).
- **On startup there is also a one-time catch-up pass**: files still named `无标题`, `无标题 3`, `未命名`, `untitled` (placeholders)
  are renamed from their `# Heading` as soon as the app opens.
  Notes created before this feature existed had a body saying `# 智能工厂` while the file stayed `无标题 8.md` — impossible to tell
  apart in Explorer — and "rename when the body changes" would never fire for them.
  Only placeholders are touched; files you named yourself are never modified, so opening the app can't rename your whole vault.
- To opt out: Settings → Editor → turn off "标题改了，文件名跟着改" (rename file with title). The startup catch-up stops too.

**Tag colors**
- Colors are assigned automatically — you never pick one. The same tag always gets the same color.
- Tags in the same set are spread across distinct hues so two never end up looking identical.
- The icon in the left tag list, the tag on the middle card and the tag in the right pane's header all use the same color.
- Light themes use a pale background with dark text; dark themes use a dark background with light text — both follow the theme.

**Archive / Hidden / Trash**
- Three fixed entries at the bottom of the left pane, independent of the active tab.
- Deleting moves to Trash first (the file is still there, just marked `trashed: true`); from Trash you can restore or delete permanently.
- Emptying the trash is two-step: the first click turns the button red ("确认清空" — confirm), and only a second click within 3 seconds really deletes.
- "已隐藏" is covered under "Hiding" above.

**Panes and appearance**
- The left and middle panes each collapse via the `‹` in their header; the collapsed state is remembered.
- The window defaults to **1570×960** (exactly enough for three comfortable panes). On smaller screens it shrinks proportionally to the
  available area (1175×655 on a 1366×768 laptop) and never spills off-screen.
- Three color schemes × light/dark, independent dimensions, six combinations:

| Scheme | Light | Dark |
| --- | --- | --- |
| Cream | Warm off-white + sage green, cards float on beige | Deep coffee, warm without glare |
| Graphite | Dark sidebar + near-white body + vermilion accents | Near-black sidebar + dark grey body |
| Paper | Neutral white, the plainest reading surface | Neutral dark grey |

- Three body fonts (system default / LXGW WenKai / Inter + Source Han Sans), three sizes and three line heights.
- A scheme only changes colors, never layout; to recolor everything you only touch `src/styles/tokens.css`.

**Keyboard shortcuts**

| Key | Action |
| --- | --- |
| `Ctrl/Cmd + K` | Search |
| `Ctrl/Cmd + N` | New note |
| `Ctrl/Cmd + B` | Bold |
| `Ctrl/Cmd + I` | Italic |
| `Ctrl/Cmd + S` | Save now (auto-save runs every 450 ms otherwise) |
| `Esc` | Close sheet / clear search / collapse swipe bar |

## 1. Project layout

```
notes-app/
├── index.html                 static three-pane skeleton
├── vite.config.ts
├── app-icon.png               icon source (1024)
├── src/                       ← front end, shared by both shells
│   ├── main.ts                bootstrap + global events
│   ├── types.ts               Note / Settings / Filter types
│   ├── store.ts               state and business logic (the only mutable source)
│   ├── bus.ts                 event bus — store notifies the UI
│   ├── settings.ts            default settings + font list
│   ├── seed.ts                sample notes written on first launch
│   ├── icons.ts               inline SVGs
│   ├── core/                  pure functions, zero platform dependencies
│   │   ├── text.ts            escaping / excerpts / todo stats
│   │   ├── fuzzy.ts           fuzzy search scoring
│   │   ├── frontmatter.ts     front matter read/write
│   │   ├── tag-color.ts       automatic tag colors (globally unique assignment)
│   │   ├── image.ts           image path conventions / asset URL resolution
│   │   ├── path.ts            path joining / filename sanitization
│   │   ├── open.ts            hand external links to the system browser
│   │   └── time.ts            time formatting
│   ├── storage/               ★ platform adapter layer
│   │   ├── adapter.ts         StorageAdapter interface
│   │   ├── ipc.ts             command channel (Electron or Tauri)
│   │   ├── desktop.ts         desktop: real files over IPC
│   │   ├── browser.ts         browser: localStorage
│   │   └── index.ts           picks one at runtime
│   ├── editor/
│   │   ├── live-preview.ts    CodeMirror decoration layer (the Live Preview core: tables / images / code blocks / links / inline marks)
│   │   ├── highlight.ts       lexer for code highlighting (built in — no prism / shiki)
│   │   ├── commands.ts        Markdown editing commands (shared by quick bar and shortcuts)
│   │   ├── image-insert.ts    image write + insert (shared by quick bar / paste / drop)
│   │   └── index.ts           mount / setReveal / setSearch / paste and drop interception
│   ├── ui/                    left / middle / right panes, sheets, theme
│   │   ├── quickbar.ts        floating quick bar at the bottom of the editor
│   │   ├── tags.ts            tag multi-select (token input)
│   │   ├── links.ts           internal link → find that note (toast when missing)
│   │   ├── lock.ts            lock screen + set-password dialog (WebCrypto digest, FNV fallback)
│   │   └── titlebar.ts        custom window buttons and drag regions for the frameless window
│   └── styles/                CSS split by area
│       ├── tokens.css         ★ all colors live here (3 schemes × light/dark = 6 sets, including code highlight colors)
│       ├── base.css           three-pane grid / collapse / frameless window buttons / toasts
│       ├── left.css           left pane (colors via the --side-* group, invertible on its own)
│       ├── mid.css            middle pane cards / swipe action bar
│       ├── right.css          right pane header / tables / code blocks / quick bar
│       ├── sheet.css          settings / sheets / segmented controls
│       └── lock.css           lock screen (z-index 110: covers the UI but leaves the window buttons)
├── electron/                  ← shell A: Electron
│   ├── main.cjs               window / tray / custom protocol / IPC
│   ├── vault.cjs              file I/O (pure Node, unit-testable)
│   ├── vault.test.cjs         14 unit tests
│   ├── preload.cjs            exposes a single invoke
│   ├── pack.mjs               packaging script
│   └── tray.png
└── src-tauri/                 ← shell B: Tauri (needs Rust to compile)
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/{main,lib,vault,settings}.rs
```

---

## 2. Where notes live

Both shells use **the same directory**, interchangeable at any time:

```
%APPDATA%\com.notesapp.desktop\
├── vault\                 ← the notes themselves
│   ├── _assets\           ← images (timestamped, unaffected by moving notes)
│   ├── 工作\
│   │   ├── 本周待办.md
│   │   └── 产品\产品方向思考.md
│   └── 生活\旅行\旅行计划：京都.md
└── settings.json          ← appearance / interaction / system settings
```

To put it elsewhere (say, inside OneDrive):

```powershell
$env:NOTES_APP_VAULT = "D:\Notes"
npm run desktop
```

Clicking the vault location in the settings panel opens that directory in Explorer.

### File format

Every note is a plain `.md` file, and the folder structure *is* the category structure. Front matter at the top holds metadata:

```markdown
---
tags: [产品, 战略]
pinned: true
archived: false
trashed: false
created: 2026-10-26T02:43:48.299Z
updated: 2026-10-26T02:43:48.299Z
order: 3000
---

# 产品方向思考

Body…

![diagram](_assets/20261026-153022-a1b2c3.png)
```

- **The `.md` files are the only source of truth.** There is no hidden database; editing them in VSCode or Obsidian is fine.
- The title is the first `# ` in the body; without one, the filename.
- Front matter is invisible in the editor (stripped by the storage layer), so the cursor can't wander into it.
- `order` is the manual sort index (lower comes first) and only exists after you drag a card; without it, notes fall back to "by update time".
  It is only written when there is a real value, so older notes never gain a stray line.
- `hidden: true` means hidden, also only written when hidden. Hidden notes appear in no list or search and don't count toward folder/tag totals.
- Delete means `trashed: true` — the file is still there. Emptying the trash is what really deletes.
- "重建索引" (rebuild index) rescans the directory; click it any time.
- Three plain-text extensions show up as ordinary text in other editors and don't affect reading:
  `[[another note]]` (internal link), trailing `{width=320}` (image width), and `→ resolution` after a todo.
- Folder order / tag order / app name / password digest live in `settings.json`, not in `.md` files — they are preferences about
  "how this vault is arranged, how this app looks", not the content of any one note.

---

## 3. Porting later

Platform-specific code is confined to two layers; not a line of business code has to change.

### Another desktop platform (macOS / Linux)

- **Electron**: `npm run desktop` runs on macOS as-is; for packaging switch `--platform` to `darwin`.
- **Tauri**: `cargo build` runs as-is; `reveal_in_file_manager` in `vault.rs` already has a `#[cfg(target_os = "macos")]` branch.
- Shortcut handling already accepts `ctrlKey || metaKey`, no change needed.

### iOS

Tauri 2 supports iOS; point the vault at the app sandbox (`app.path().document_dir()`) and the front end needs zero changes.
Electron has no iOS path — that's the main reason the Tauri shell is kept around.

### Another storage backend (WebDAV / SQLite / cloud)

Implement the 11 methods of `StorageAdapter`:

```ts
init(): Promise<VaultInfo>
list(): Promise<RawFile[]>
read(relPath: string): Promise<RawFile | null>
write(relPath: string, raw: string): Promise<number>
remove(relPath: string): Promise<void>
move(from: string, to: string): Promise<void>
prune?(folderRel: string): Promise<void>                    // reclaim empty folders (after renames / moves)
writeAsset?(relPath: string, base64: string): Promise<void>   // images; without it, falls back to data URLs
loadSettings(): Promise<unknown>
saveSettings(s: unknown): Promise<void>
reveal?(): Promise<void>
setAutostart?(on: boolean): Promise<void>
```

### Another shell

Both shells expose **exactly the same IPC command names and parameters** — 17 in total:

- 8 for the vault: `vault_info` / `vault_list` / `note_read` / `note_write` / `note_remove` /
  `note_move` / `vault_prune` / `asset_write`
- 4 for settings and the system: `settings_load` / `settings_save` / `vault_reveal` / `set_autostart`
- 1 for external links: `open_external`
- 4 for the frameless window: `win_minimize` / `win_toggle_max` / `win_close` / `win_is_max`

A new shell only needs those 17 commands plus one branch in `src/storage/ipc.ts`.

> The Electron side also registers `asset_exists`, left over from an early image-placeholder attempt. Nothing in the front end
> calls it and the Tauri side never implemented it. Safe to delete from both.

Image display goes through a separate layer: Electron uses a custom `vault://local/<vault path>?b=<note folder>` protocol
(the page runs under `app://`, and reading `file://` across protocols is blocked), Tauri uses `asset://`
(`security.assetProtocol.enable = true` in `tauri.conf.json`).

### Full-text index

Right now every `.md` is read into memory at startup; search stays in the millisecond range up to a few hundred thousand characters.
At the hundred-thousand-note scale, move to SQLite FTS5:

```sql
-- Chinese requires trigram; unicode61 is useless for it
CREATE VIRTUAL TABLE notes_fts USING fts5(
  rel_path UNINDEXED, title, body, tokenize = 'trigram'
);
```

The index table can be `DROP`ped and rebuilt at any time, because the `.md` files are the source of truth. Afterwards the front end
only has to swap `searchNotes()` for a single IPC call.

## 4. Pitfalls hit while building this

**① `-webkit-app-region: drag` is a window-level hit region and ignores z-index**

A frameless window is dragged via a CSS drag region. That region's rectangle is computed from layout, and **elements drawn on top of
it still receive no mouse events**. At one point the right pane's placeholder `.blank` (`flex:1`, filling the column) was marked
`drag`, and the right half of the settings sheet plus the close button became completely unclickable — that area had been taken
over by window dragging.

Rule: only put `drag` on a narrow top strip, never on an element that fills a large area; sheets' `.backdrop` is always `no-drag`
(`no-drag` carves itself out of the drag region, so opening a sheet disables every drag area beneath it).

Related: `webContents.sendInputEvent()` injects at the renderer's input layer and **bypasses window-level hit testing**, so clicking
buttons with it in a smoke test cannot catch this class of bug. The only way is asserting `getComputedStyle(el).webkitAppRegion`.

The same trap caught us a second time, in a subtler shape: the rail buttons that appear after collapsing a pane (`.rail`,
8–70 × 9–37) sat inside `.brand`'s drag rect (0–238 × 0–58) — and `.brand` still reports that rect even when the left pane is 0px wide,
because its contents overflow the collapsed column. Both rail buttons were completely unclickable with a real mouse, while injected
CDP clicks worked perfectly and proved nothing. Fix: `-webkit-app-region: no-drag` on `.rail`, which carves it out of the drag region.

**② Vite's `emptyOutDir` does one `rmSync` of the whole directory**

`dist/assets` holds 200+ font subsets; deleting that many at once trips bulk-delete guards in sandboxes and antivirus, and the build
fails outright. So `vite.config.ts` sets `emptyOutDir:false` and `scripts/clean-dist.mjs` unlinks files one by one.

**③ Block-level `Decoration.replace` can only come from a `StateField`**

In CodeMirror 6, whole-block replacements (tables, images) must be provided from a `StateField`'s `provide`. Providing them from a
`ViewPlugin` **fails silently** — no error, `errors=none`, just a blank area.
Hence `live-preview.ts` has two field pairs: `tableBlocksField + tableField` and `imageBlocksField + imageField`. The `ViewPlugin`
only handles source styling for "cursor inside the block"; the two must never decorate the same line.

**④ Fixed-position overlays cover the sheet's own buttons**

In the "organize" sheet the tag row sits right next to Cancel / Save. The first version gave tags a dropdown suggestion menu, which
landed exactly on top of those two buttons — so clicking Save added a tag instead. The fix was **a row of pale chips inside the sheet**:
click to add, no overlay, no click-through. Any future overlay inside a sheet: first ask whether it covers the bottom buttons.

**⑤ Drag-reorder and swipe share one pointer gesture**

A single `pointerdown` can only mean one thing. `mid.ts` uses a `mode` state machine that decides on the first movement past 6px:
vertical intent → reorder, horizontal intent → swipe bar. **Once locked, the direction never changes**, otherwise a twitchy hand
flips modes. The drop target is also clamped to the same pin group (`clampToGroup`); dropping across groups is immediately
bounced back by the sort rule.

**⑥ On Windows `.md` files are CRLF, and `split(/\n{2,}/)` won't split them**

This is the root cause of the "card content sometimes doesn't show" bug. Files edited in Notepad or another editor use `\r\n`,
while `split(/\n{2,}/)` only recognizes `\n\n`, so the whole note becomes **one block**; then the "drop the first block if it's a
heading" rule throws away that single block and the excerpt is empty. Tables and image blocks failing to render had the same cause.

The fix is to **normalize once at the entry point**: `raw.replace(/\r\n?/g, '\n')` in `parseFrontMatter()`. Every downstream
"split on blank lines" routine (excerpts, tables, images) then works. Writing back always uses `\n` in `serializeFrontMatter()`,
so it doesn't flip-flop. Any future code that reads a file and processes it line by line should think about line endings first.

**⑦ "Clicking an image turns it into source" wasn't our code — it was CodeMirror**

`ImageWidget` used to carry only a `clickToEdit`, but what actually moved the cursor into the image line was CodeMirror's own
`mousedown` handler: once the cursor lands in the replaced line, `buildImages` swaps the whole line back to source.
So deleting `clickToEdit` alone did nothing — `mousedown` on the `figure` had to `preventDefault()` + `stopPropagation()` to
intercept before it reaches `contentDOM`. Only then can a single click mean "select".

Code blocks later moved to double-click-to-edit and hit **the same trap**: `dblClickToEdit()` must also swallow `mousedown`, or the
click puts the cursor inside the block, `codeField` instantly reverts it to source, and `dblclick` never gets dispatched.
One sentence: **if "cursor inside the block" is what reveals the source, the mouse event must be intercepted at the `mousedown` stage.**

**⑧ Resizing rebuilds the whole widget, so selection state can't live in the DOM**

Every width change is a document change → `imageField` recomputes → `ImageWidget` is rebuilt → the old `figure` disappears along
with its `.selected` class. Keep selection in the DOM and the handle vanishes after the first drag; you'd have to click again to resize twice.
So selection lives in `selectedImageField` (a `StateField<number>` holding the line start), and the rebuilt widget re-applies the class
from it. The resize transaction carries a `setSelectedImageEffect.of(line.from)` so selection survives. Likewise, **don't** dispatch
a transaction per pixel while dragging — only update inline styles and `dispatch` once on `mouseup`.

**⑨ Putting a "separator" class on a button squashes it to 1px**

The toolbar needs a vertical line before "edit". The first version lazily added a `sep` class (`width:1px`) to the button itself, so the
button became 1px wide and its label overflowed and got clipped. A separator must be **its own empty element**. The smoke assertion
`overflow: tb.scrollWidth - tb.clientWidth` exists for this.

**⑩ After a code block becomes a block widget, tables and images inside it must be skipped**

Once a code block is a block widget, if it contains `| a | b |`, `tableBlocksField` will try to replace those lines with a table
widget — two block-level replaces with overlapping ranges make CodeMirror throw and blank the page.
So `collectTables()` / `collectImages()` both compute `fenceMask()` first and skip every line inside a fence.
`code={… "tables":0}` in the smoke output guards this.

**⑪ Link clicks must intercept `mousedown` in the capture phase**

CodeMirror's own `mousedown` is bound on `contentDOM`; by the time the event bubbles to `view.dom`, it has already moved the cursor
into that line. The cursor entering the line reverts it to source, the link `<span>` is replaced on the spot, and `target` no longer
matches at `click` time. So `linkPlugin` uses `addEventListener('mousedown', fn, true)` and does `preventDefault + stopPropagation`
on a hit.

**⑫ A note at the vault root has `folder` = "收集箱" but is not in that folder**

In `toNote()`, `folder: rawFolder || DEFAULT_FOLDER`: a `.md` dropped straight into the vault root gets the display folder "收集箱"
(Inbox), while its `relPath` is still `xxx.md`. Any code that **builds a file path from `note.folder`** will move those files into
the Inbox (this bit us on title renames and folder renames). All file operations must use `dirOf(note.relPath)`; `note.folder` is for display only.

**⑬ Folder rename only moves files — empty subfolders stay behind**

`vault.rename()` is `fs.renameSync`, which only moves files. After `技术/子目录/深层.md` moves away, `技术/子目录/` **still exists as an
empty directory**, so the "reclaim the old folder" logic sees entries inside and refuses to delete — the old folder lingers forever.
`vault.prune()` must **recurse down to remove empty subfolders first**, then walk back up, and only delete empty ones.

---

## 5. Known limitations

- Syntax highlighting is a hand-written lexer (`src/editor/highlight.ts`). It covers common languages but is **not a full parser**:
  no multi-line string continuations, no JS inside template strings, no heredocs. Extreme code may color inaccurately (the text itself is fine).
- Code blocks render as a whole, so **to select and copy text inside one you must double-click into source first**; to copy the entire
  block use the "copy" button at its top right.
- `[[title]]` fuzzy title matching only accepts a **unique result**; with two notes of the same name it falls back to path matching.
- The filename rename triggered by a title change has a 1.4 s debounce — quitting immediately after editing may skip the rename
  (the content itself is saved).
- Images must be alone on their line to render. Width supports `{width=320}` / `{width=50%}`, but that's this app's own extension;
  other Markdown editors show it as plain text.
- Tables and images render as blocks, so text inside them doesn't participate in search highlighting (the "N matches" count still includes it).
- Card thumbnails are a fixed 96px tall. A single image keeps its aspect ratio, so very wide images stop at the card width (scaled down
  beyond that) and very tall ones look narrow; two or more share a row evenly, at most 3 visible (`cover`-cropped to one box), with the
  4th onward collapsed into `+N`. The card doesn't say which images those are and they can't be opened from there.
- **The password lock is not encryption**: notes stay plaintext `.md` on disk and the lock only gates "opening this app".
  Real confidentiality needs an OS account password / BitLocker / an encrypted volume.
- The locked state gates the UI, not the files: while locked, other programs can still read the note files.
- A forgotten password can only be fixed by hand in `settings.json` (clear `lockHash`, set `lockEnabled` to `false`); there is no recovery flow in the app.
- `.md` files sitting directly in the vault **root** are shown under "收集箱" in the UI (the files themselves don't move).
  Renaming "收集箱" in that state will not move them — file operations use the real path, see pitfall ⑫.
- Changes made by external editors appear only after switching away from the window and back (no file watching).
- Moving or deleting image files doesn't clean up references in note bodies (you just see "image not found" at render time).
- In browser mode (`npm run dev`) images live in localStorage with a 5 MB cap — enough for debugging only.
- The Electron build is 278 MB packaged (Tauri would be ~8 MB but needs Rust).
- Autostart registers `electron.exe` in dev mode and points at `Notes.exe` once packaged.

---

## 6. FAQ

**`cd notes-app` says the path doesn't exist**

The full path contains spaces, so it must be quoted:

```powershell
cd "D:\我的项目\notes-app"
```

**`npm run desktop` fails with `Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')`**

`ELECTRON_RUN_AS_NODE=1` is set in the environment, so Electron runs as plain Node. Clear it and retry:

```powershell
$env:ELECTRON_RUN_AS_NODE = $null
npm run desktop
```

**`npm run desktop:pack` fails with `ECONNRESET`**

The packager is trying to re-download Electron. The script already prefers the local cache (`%LOCALAPPDATA%\electron\Cache`);
if it still fails, run `npm install electron` to populate the cache, then retry.

**`npm run app:dev` (Tauri) fails with `linker 'link.exe' not found`**

The Windows SDK is missing or the wrong version. VS Installer → Individual components → check **Windows 11 SDK (10.0.22621.0)**,
then reopen the terminal.

**The package is huge**

181 MB of the 278 MB is Electron's bundled Chromium + Node runtime; that can't be trimmed without switching to Tauri.
Your own code and the offline fonts make up `resources\app.asar`, only 10.4 MB.

To go smaller: remove the two `@import` lines for `lxgw-wenkai-webfont` in `src/styles/index.css`. The font option falls back to
system fonts automatically and the asar drops to roughly 2 MB.

**Double-clicking the new `Notes.exe` does nothing and the old window comes forward instead**

The old version is still running and holds the "only one instance" lock, so the new process is rejected and the system raises the
existing window — which looks exactly like "the new version didn't take effect".

Two processes writing the same `.md` files would clobber each other, so the lock can't be removed. The fix: right-click the tray
icon in the notification area → Quit, then double-click the new `Notes.exe`.

Newer builds show a dialog explaining this, so "clicked and nothing happened" no longer occurs.

**There's no title bar — how do I drag or close the window?**

The title bar is intentionally gone. To drag: press and hold the empty strip along the top of the three panes (the "笔记" row in the
left pane, the middle pane's header row, the right pane's breadcrumb row). Close / maximize / minimize: the `— □ ✕` at top right.
Double-clicking the top strip also maximizes.

**Clicking a table does nothing and I can't edit it**

A single click puts the cursor in and turns the block into Markdown source — that's when you can edit it; click elsewhere to render
it back. If you only drag-select text, editing is not triggered.

**`npm run desktop:pack` fails with `SAFE_DELETE_BULK_CONFIRM_REQUIRED` or `EPERM`**

The old output directory can't be deleted (blocked by a delete guard, or Defender is scanning that 181 MB exe).
The packaging script no longer deletes anything: it packs into the system temp directory first, then overwrites file by file.
If the target exe is running, it writes to `dist-app-2\` instead.

**The Tauri build fails with `no method named show_menu_on_left_click`**

Early Tauri 2.x called it `menu_on_left_click`. Rename that method in `src-tauri/src/lib.rs`, or delete the line — left-clicking the
tray then shows the menu instead of the window.



