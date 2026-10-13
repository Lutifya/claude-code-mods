# claude-code-mods

Two mods for [Claude Code](https://claude.com/claude-code), written with its function-hooks plugin API.

| Mod | What it does |
| --- | --- |
| [`next-steps`](./next-steps) | A band above the prompt: three suggested next prompts and a usage line (cost, context, 5h/7d limit bars). |
| [`scratch`](./scratch) | A scratch pad you draw on with the mouse, opened with `/scratch` and already holding the keyboard; hands Claude the drawing as a PNG. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install next-steps --marketplace Lutifya/claude-code-mods
/plugin install scratch --marketplace Lutifya/claude-code-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads the mod in every session).

The function-hooks API is early access and moves between Claude Code releases; these mods were built and tested on Claude Code 2.1.296.

## next-steps

```
next:
  1: Run the traversal test checklist
  2: Commit the pending work
  3: Wire in the story slideshow
  0: dismiss
$0.01 · ctx 82.1k/1000.0k (8%) · 7d ██████████ 91% (resets 21h30m) · 5h ░░░░░░░░░░ 0% (resets 4h30m) · +8.7k +0% +$0.12 (last prompt)
```

- **Suggestions.** When a turn of the main conversation ends, the mod asks the session's model for three next prompts, over the session's own transcript (`$.model.fork`), so the prefix comes from the prompt cache.
- **Picking one.** Press `1`, `2` or `3` with the prompt empty (or click a suggestion) and it lands in the prompt box for you to edit and send; `0` dismisses the list. With text already in the box it is appended.
- **Usage line.** Session cost, context fill, and the 7-day and 5-hour rate-limit windows with their reset countdowns (green under 60%, amber to 90%, red above). The bars show only on a subscription that reports them.
- **(last prompt).** What changed since your last prompt went in: context tokens added, 5-hour points used, dollars spent.

**Cost.** Each main-thread turn makes one extra request: a cache read of the transcript plus about fifty output tokens on the session's model. It counts toward the limits the band draws.

**Heads-up.** A bare digit typed into an empty prompt goes to the band. If Claude asks "1 or 2?" and you answer by typing `1`, you get the suggestion in the box instead; delete it and type again.

## scratch

```
[█] █  █  █  █  █  █  █  erase  -1+ undo clear
   ⢀⡠⠔⠒⠒⠢⢄⡀
  ⡰⠁      ⠈⢆      ⣀⠤⠒⠉⠉⠒⠤⣀
  ⢣⡀      ⢀⡜   ⠉⠁         ⠈⠉
   ⠈⠢⢄⣀⣀⡠⠔⠁
```

- `/scratch` opens the pad with the keyboard and the pointer already in it: no click to focus first. It works while a turn is running too.
- **Mouse.** Left-drag draws, right-drag erases. Each cell is a braille character of 2 × 4 dots, so a line is one dot thin. The top row is a toolbar: eight colors, `erase`, nib size `- n +`, `undo`, `clear`.
- **Keys.** `1`-`8` color, `e` eraser, `+`/`-` size, `u` undo, `c` clear, `Esc` back to the prompt.
- **→ prompt** saves the drawing as a PNG (white page, smooth strokes, cropped to what you drew) under `~/.claude/scratch/` and puts an `@` mention of it in the prompt, so Claude can open the picture. Each save deletes the sketches there older than a week; `/scratch prune` does it right away.
- `/scratch clear` wipes it. The drawing persists across sessions (one pad, shared by every project).

**Needs the fullscreen terminal layout** (see `/config`): only there does Claude Code receive mouse events. Terminals that report sub-cell pointer positions (Ghostty, iTerm2, kitty, WezTerm) put the pen on the very dot; elsewhere, tmux included, it snaps to the middle of each cell and the line between moves is filled in dot by dot.

## Develop

Each mod is a plugin folder: `.claude-plugin/plugin.json`, `hooks/hooks.json` naming `hooks/register.tsx`, a state contract in `types/index.d.ts`, and tests.

```
claude plugin validate ./scratch
claude plugin test ./scratch
claude --plugin-dir ./scratch    # a session with the mod loaded from this folder
```

## License

MIT
