// The drawing, one string per dot row: ' ' is empty, '1'..'8' a palette
// color. A terminal cell holds 2 × 4 dots, drawn as one braille character.
export type Canvas = string[]

// What the hooks module hands the pad's surface module as its props.
export type PadProps = { canvas: Canvas; rev: number }

declare module 'claude-code' {
  interface PluginState {
    scratch: {
      // Bumped when the drawing changes from outside the pad (/scratch clear),
      // so a pad on screen drops what it holds and takes the new canvas.
      rev: number
    }
  }
}
