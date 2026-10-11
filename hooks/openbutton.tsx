// The Board chip in the band above the chat box (KB-0028): a Client, so the first click acts (a native Button's first click only
// gives the keyboard). One row, drawn like a card of the board: a borderless rounded-looking fill with a quiet label, a lighter fill
// under the pointer. A press posts { type: 'open' } to the ui.message hook in hooks/register.tsx, which opens the pane. It has no `$`.
// A variable is never named `h`: JSX compiles to calls of `h`.
import type { ClientModule, ClientPointerEvent, ClientSurface } from 'claude-code'

/** The fill of the chip and of the chip under the pointer, as theme keys (KB-0041): the surface fill the board's cards use, and a mid grey of the theme under the pointer, with the label in the default colour, so the chip reads in the light and the dark theme. */
const CHIP_BG = 'composerSidebarBackground'
const CHIP_HOVER_BG = 'subtle'

type ChipProps = { label: string }

function press(e: ClientPointerEvent, surface: ClientSurface<unknown>): void {
  if (e.type !== 'down') return
  surface.post({ type: 'open' })
}

const openButton: ClientModule<ChipProps> = (props, surface) => {
  const { Box, Text } = surface.elements
  try {
    surface.onPointer((e) => {
      try {
        press(e, surface)
      } catch {
        // a handler must never throw
      }
    })
    const label = typeof props.label === 'string' ? props.label : 'Board'
    return (
      <Box flexDirection="row">
        <Box key="chip" paddingX={2} backgroundColor={CHIP_BG} hover={{ backgroundColor: CHIP_HOVER_BG }}>
          <Text>{'▦ ' + label}</Text>
        </Box>
      </Box>
    )
  } catch {
    return <Text dimColor>Board</Text>
  }
}

export default openButton
