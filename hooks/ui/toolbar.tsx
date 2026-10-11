// The toolbar (KB-0024 step 4): drawn between the header and the lanes on the Board tab, from the normal tree's own elements so
// the desktop draws real controls. Two rows. Row 1: the `New card` button at the left, the Find field in the growing space (with
// `Clear` while text is typed), the one Sort for the whole board at the right edge. Below 60 cells the Find field takes a row of its own
// under row 1. Row 2: the dim card count at the left, lined up with `New card` (`4 of 32 match` while Find is on; `No card matches "x"` and
// a `Clear` button when nothing matches), and a growing gap, then ONE quiet plain button at the right that names what it will do:
// `Collapse all` while any lane is open, else `Expand all` (they set every lane's fold in the kept view and bump its `stamp`). It is
// not drawn while Find is on (the lanes with matches are open whatever the folds say).
// `New card` reveals a second place under it: the title field, the type, the lane the card is made in and `Cancel`; the one `Add` is the
// submit the app draws beside the field (`submitLabel`), as the open card's comment field does (no second `Add` button, KB-0041).
// From 92 cells those four share one row; below that the field has the row to itself and the type, the lane and `Cancel` share the next; below 60 the type has a row of its own and the lane and `Cancel` sit under it. Widths come from flex alone; a Select reserves 2 rows and a Button 1, so the rows centre.
// The title field (KB-0040): a native Input has no width prop and draws at its own width inside the Box that holds it (the Box grew,
// the field did not). So its Box is a COLUMN with stretch (a column stretches its child across the Box) and takes all the free width
// of the row (flexGrow 1); the Lane Box sizes to its value and does not grow, so the room goes to the field. Text longer than the
// field scrolls inside it, as a native field does.
// Nothing here has `$`: the presses are closures (hooks/register.tsx runs them).
import type { EngineInterface } from 'claude-code'

type Els = ReturnType<EngineInterface['ui']['resolve']>

/** From this many cells the new-card controls share one row. */
export const WIDE_ADD = 92

/** Below this many cells the Type list has a row of its own, and the Lane list and Cancel share the one under it. */
export const TYPE_OWN_ROW = 60

/** Below this many cells the Find field takes a row of its own. */
export const FIND_OWN_ROW = 60

/** Everything the toolbar draws, worked out by the pane. */
export type ToolbarProps = {
  columns: number
  /** The board cannot be read: no New card, the Sort stays (it is a view). */
  isReadOnly: boolean
  /** The new-card row is shown. */
  isOpen: boolean
  /** The row was opened just now: the title field takes the focus on this drawing only. */
  isFresh: boolean
  /** The title typed so far. */
  title: string
  /** The lanes a person may create a card in, by label, in board order. */
  lanes: string[]
  /** The chosen lane's label (always one of `lanes`). */
  lane: string
  /** The board's ticket type names in order (the Type list). */
  types: string[]
  /** The chosen type's name (always one of `types`). */
  type: string
  /** The sort shown: a sort key. */
  sort: string
  sortOptions: { value: string; label: string }[]
  /** How many cards the board holds. */
  count: number
  /** The Find text typed so far. */
  find: string
  /** How many cards match Find, or null while Find is off (no words typed). */
  matched: number | null
  /** Some lane with cards is drawn open (so the one fold button says `Collapse all`; else `Expand all`). */
  isAnyOpen: boolean
}

/** What a press on the toolbar does. */
export type ToolbarActions = {
  open: () => void
  cancel: () => void
  type: (value: string) => void
  /** Enter or the field's own `Add` gives the text (`null` reads the typed title, for a press that has no text). */
  add: (value: string | null) => void
  pickLane: (label: string) => void
  pickType: (name: string) => void
  pickSort: (key: string) => void
  /** Typing in the Find field: the text so far. */
  setFind: (value: string) => void
  /** Enter in the Find field: opens the first match in board order. */
  openFirst: () => void
  /** `Clear`: empties the Find field. */
  clearFind: () => void
  /** `Collapse all`: folds every lane. */
  collapseAll: () => void
  /** `Expand all`: opens every lane that has cards. */
  expandAll: () => void
}

/** The flexible room of a row. */
function spacer(el: Els, key: string, grow: number) {
  const { Box } = el
  return <Box key={key} flexGrow={grow} />
}

function addRow(el: Els, p: ToolbarProps, act: ToolbarActions) {
  const { Box, Input, Select, Button } = el
  const isWide = p.columns >= WIDE_ADD
  const field = (
    <Box key="toolbar-title-box" flexGrow={1} flexShrink={1} minWidth={isWide ? '35%' : 0} flexDirection="column" alignItems="stretch">
      <Input
        key="toolbar-title"
        placeholder="What needs doing?"
        value={p.title}
        submitLabel="Add"
        {...(p.isFresh ? { autoFocus: true as const } : {})}
        onInput={(value: string) => act.type(value)}
        onSubmit={(value: string) => act.add(value)}
      />
    </Box>
  )
  const lane = (
    <Box key="toolbar-lane-box" flexGrow={0} flexShrink={0}>
      <Select
        key="toolbar-lane"
        label="Lane"
        options={p.lanes.map((value) => ({ value }))}
        value={p.lane}
        onSelect={(value: string) => act.pickLane(value)}
      />
    </Box>
  )
  const type = (
    <Box key="toolbar-type-box" flexGrow={0} flexShrink={0}>
      <Select
        key="toolbar-type"
        label="Type"
        options={p.types.map((value) => ({ value }))}
        value={p.type}
        onSelect={(value: string) => act.pickType(value)}
      />
    </Box>
  )
  const buttons = [
    <Box key="toolbar-cancel-box" flexShrink={0}>
      <Button key="toolbar-cancel" plain label="Cancel" onPress={() => act.cancel()} />
    </Box>,
  ]
  if (isWide) {
    return (
      <Box key="toolbar-add-row" flexDirection="row" alignItems="center" columnGap={2} marginTop={1}>
        {field}
        {type}
        {lane}
        {buttons}
      </Box>
    )
  }
  if (p.columns < TYPE_OWN_ROW) {
    return (
      <Box key="toolbar-add-rows" flexDirection="column" marginTop={1}>
        <Box key="toolbar-add-field-row" flexDirection="row">
          {field}
        </Box>
        <Box key="toolbar-add-type-row" flexDirection="row" alignItems="center">
          {type}
        </Box>
        <Box key="toolbar-add-pick-row" flexDirection="row" alignItems="center" columnGap={2}>
          {lane}
          {buttons}
        </Box>
      </Box>
    )
  }
  return (
    <Box key="toolbar-add-rows" flexDirection="column" marginTop={1}>
      <Box key="toolbar-add-field-row" flexDirection="row">
        {field}
      </Box>
      <Box key="toolbar-add-pick-row" flexDirection="row" alignItems="center" columnGap={2}>
        {type}
        {lane}
        {buttons}
      </Box>
    </Box>
  )
}

/** `32 cards`, `1 card`, `0 cards`; with Find on (`matched` given) `4 of 32 match`. */
export function countWords(count: number, matched: number | null = null): string {
  if (matched !== null) return `${matched} of ${count} match`
  return `${count} ${count === 1 ? 'card' : 'cards'}`
}

/** The line shown when Find matches nothing: `No card matches "zzzz"`. */
export function noMatchText(find: string): string {
  return `No card matches "${find.trim()}"`
}

/** The Find field, and `Clear` beside it while text is typed. It takes the growing space of row 1 (or a row of its own). */
function findField(el: Els, p: ToolbarProps, act: ToolbarActions) {
  const { Box, Input, Button } = el
  return (
    <Box key="toolbar-find-slot" flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row" alignItems="center" columnGap={1}>
      <Box key="toolbar-find-box" flexGrow={1} flexShrink={1} minWidth={0}>
        <Input
          key="toolbar-find"
          placeholder="Find a card"
          value={p.find}
          onInput={(value: string) => act.setFind(value)}
          onSubmit={() => act.openFirst()}
        />
      </Box>
      {p.find !== '' && (
        <Box key="toolbar-find-clear-box" flexShrink={0}>
          <Button key="toolbar-find-clear" plain label="Clear" onPress={() => act.clearFind()} />
        </Box>
      )}
    </Box>
  )
}

export function toolbarTree(el: Els, p: ToolbarProps, act: ToolbarActions) {
  const { Box, Text, Button, Select } = el
  const isOwnRow = p.columns < FIND_OWN_ROW
  return (
    <Box key="toolbar" flexDirection="column" paddingX={2} marginBottom={2}>
      <Box key="toolbar-row" flexDirection="row" alignItems="center" columnGap={2}>
        {!p.isReadOnly && (
          <Box key="toolbar-new-box" flexShrink={0}>
            <Button key="toolbar-new" label="New card" onPress={() => act.open()} />
          </Box>
        )}
        {isOwnRow ? spacer(el, 'toolbar-gap', 1) : findField(el, p, act)}
        <Box key="toolbar-sort-box" flexShrink={0}>
          <Select
            key="toolbar-sort"
            label="Sort"
            options={p.sortOptions}
            value={p.sort}
            onSelect={(value: string) => act.pickSort(value)}
          />
        </Box>
      </Box>
      {isOwnRow && (
        <Box key="toolbar-find-row" flexDirection="row" alignItems="center">
          {findField(el, p, act)}
        </Box>
      )}
      <Box key="toolbar-count-row" flexDirection="row" alignItems="center" columnGap={1} marginTop={1}>
        {p.matched === 0 ? (
          <Box key="toolbar-none-box" flexShrink={1} minWidth={0} paddingX={1}>
            <Text key="toolbar-none" dimColor wrap="truncate-end">
              {noMatchText(p.find)}
            </Text>
          </Box>
        ) : (
          <Box key="toolbar-count-box" flexShrink={0} paddingX={1}>
            <Text key="toolbar-count" dimColor>
              {countWords(p.count, p.matched)}
            </Text>
          </Box>
        )}
        {p.matched === 0 && (
          <Box key="toolbar-none-clear-box" flexShrink={0}>
            <Button key="toolbar-none-clear" plain label="Clear" onPress={() => act.clearFind()} />
          </Box>
        )}
        {spacer(el, 'toolbar-fold-slot', 1)}
        {p.matched === null && (
          <Box key="toolbar-fold-box" flexShrink={0}>
            {p.isAnyOpen ? (
              <Button key="toolbar-fold" plain label="Collapse all" onPress={() => act.collapseAll()} />
            ) : (
              <Button key="toolbar-fold" plain label="Expand all" onPress={() => act.expandAll()} />
            )}
          </Box>
        )}
      </Box>
      {p.isOpen && !p.isReadOnly && addRow(el, p, act)}
    </Box>
  )
}
