// The header of the kanban pane (KB-0024 step 3): built from the normal tree's own elements, so the desktop draws real
// controls. No Client, no rectangles; widths come from flex and a part that may not fit is a truncating Text in a Box that
// may shrink (docs/design/desktop-paint-notes.md rules 2 and 5).
//
// What is on it, most prominent first: `◆ 3 need you` (the diamond in the warning colour, the words a flat button; nothing at all when
// nothing waits), with the kinds beside it; the Board / Settings tabs at the right end of the same row, the chosen one on a filled
// chip; under them what Claude is doing: a dot in the accent and `Claude is on KB-0014` (a link that opens the card), how long ago
// it last changed, the workers in use of the limit, the cards waiting to start, and the note (what the agent is doing) on a row of its own when there is one. Everything but the
// button is quiet text. The words come from headerWords in ../lib/header.ts. Nothing here has `$`: the presses are closures.
import type { EngineInterface } from 'claude-code'

import { headerWords } from '../lib/header.ts'
import type { HeaderProps, HeaderTabWords, HeaderWords } from '../lib/header.ts'

type Els = ReturnType<EngineInterface['ui']['resolve']>

/** The surface fill (spec 1): the chosen tab's chip and a tab under the pointer. */
const SURFACE = 'userMessageBackground'

/** What a press on the header does (hooks/register.tsx runs these). */
export type HeaderActions = {
  /** The attention button: opens the first card waiting on the person, then the next. */
  openWaiting: () => void
  /** The Claude text: opens a card. */
  select: (id: string) => void
  /** A tab: shows it, or (the chosen Board tab with a card open) closes the card. */
  tab: (tab: 'board' | 'settings') => void
  /** `Change to opus`: copies `/model opus`; runs nothing. */
  copyModel: () => void
  /** `Keep sonnet`: the board's Manager model becomes the chat's model (the Settings tab's own write); nothing runs. */
  keepModel: () => void
}

/** A flexible spacer: the free room of a row. */
function spacer(el: Els, key: string) {
  const { Box } = el
  return <Box key={key} flexGrow={1} />
}

/** A text that is cut with `…` at the edge of the room it gets rather than running out of its row. */
function cut(el: Els, key: string, text: string, marginLeft: number, grow: boolean) {
  const { Box, Text } = el
  return (
    <Box key={key} flexGrow={grow ? 1 : 0} flexShrink={1} minWidth={0} overflow="hidden" marginLeft={marginLeft}>
      <Text dimColor wrap="truncate-end">
        {text}
      </Text>
    </Box>
  )
}

/** One tab: a plain button on a padded chip; the chosen tab's chip is filled, the other's label is quiet and its chip lights under the pointer. */
function tabOf(el: Els, t: HeaderTabWords, act: HeaderActions) {
  const { Box, Button } = el
  const press = () => {
    if (t.isActing) act.tab(t.tab)
  }
  if (t.isChosen) {
    return (
      <Box key={`header-tab-box-${t.tab}`} flexShrink={0} paddingX={1} backgroundColor={SURFACE}>
        <Button key={`header-tab-${t.tab}`} plain label={t.label} onPress={press} />
      </Box>
    )
  }
  return (
    <Box key={`header-tab-box-${t.tab}`} flexShrink={0} paddingX={1} hover={{ backgroundColor: SURFACE }}>
      <Button key={`header-tab-${t.tab}`} plain dimColor label={t.label} onPress={press} />
    </Box>
  )
}

/** The first row: what waits on the person, and the tabs. */
function youRow(el: Els, w: HeaderWords, act: HeaderActions) {
  const { Box, Text, Button } = el
  const a = w.attention
  return (
    <Box key="header-you" flexDirection="row">
      {a.total > 0 ? (
        <Box key="header-attention-box" flexShrink={0} flexDirection="row">
          <Text color="warning">{'◆'}</Text>
          <Box marginLeft={1}>
            <Button key="header-attention" plain label={a.label} onPress={() => act.openWaiting()} />
          </Box>
        </Box>
      ) : null}
      {a.total > 0 && a.kinds !== '' && w.isKindsBeside && cut(el, 'header-kinds', a.kinds, 2, false)}
      {spacer(el, 'header-you-gap')}
      {tabOf(el, w.boardTab, act)}
      {tabOf(el, w.settingsTab, act)}
    </Box>
  )
}

/** `● Claude is on KB-0014`: the accent dot, and the words as a link to the card, or quiet when idle. */
function whoOf(el: Els, w: HeaderWords, act: HeaderActions) {
  const { Box, Text, Button } = el
  const c = w.claude
  const card = c.card
  return (
    <Box key="header-who" flexShrink={0} flexDirection="row">
      <Text {...(c.isActive ? { color: 'claude' } : { dimColor: true })}>●</Text>
      <Box marginLeft={1}>
        {card !== null ? (
          <Button key="header-claude" plain label={c.who} onPress={() => act.select(card)} />
        ) : (
          <Text dimColor>{c.who}</Text>
        )}
      </Box>
    </Box>
  )
}

/** The workers in use of the limit, the cards waiting to start, the turn: each its own piece, 2 cells apart. */
function countsOf(el: Els, w: HeaderWords) {
  const { Box, Text } = el
  const c = w.claude
  const out = []
  if (c.workers !== null) {
    out.push(
      <Box key="header-workers" flexShrink={0} marginLeft={2}>
        <Text dimColor>{c.workers}</Text>
      </Box>,
    )
  }
  if (c.waiting !== null) {
    out.push(
      <Box key="header-waiting" flexShrink={0} marginLeft={2}>
        <Text bold color="claude">
          {c.waiting}
        </Text>
      </Box>,
    )
  }
  if (c.turn !== null) {
    out.push(
      <Box key="header-turn" flexShrink={0} marginLeft={2}>
        <Text color="claude">{c.turn}</Text>
      </Box>,
    )
  }
  return out
}

function changedOf(el: Els, w: HeaderWords) {
  const { Box, Text } = el
  return (
    <Box key="header-changed" flexShrink={0} marginLeft={2}>
      <Text dimColor>{w.changed}</Text>
    </Box>
  )
}

/** What Claude is doing: one row from 100 cells (the note under it), else the line with the time, and the note with the counts under it. */
function claudeRows(el: Els, w: HeaderWords, act: HeaderActions) {
  const { Box } = el
  const c = w.claude
  const counts = countsOf(el, w)
  // Two or more workers: one note line per worker, each its own row under the line (the first shares the counts row below 100 cells).
  const lines = c.notes.length > 0 ? c.notes : c.detail !== null ? [c.detail] : []
  const note = lines.length > 0 ? cut(el, 'header-step', lines[0] as string, 0, false) : null
  const more = lines.slice(1).map((text, k) => (
    <Box key={`header-note-row-${k + 2}`} flexDirection="row" paddingLeft={2}>
      {cut(el, `header-step-${k + 2}`, text, 0, false)}
    </Box>
  ))
  if (w.isClaudeOneRow) {
    return [
      <Box key="header-claude-row" flexDirection="row">
        {whoOf(el, w, act)}
        {spacer(el, 'header-claude-gap')}
        {counts}
        {changedOf(el, w)}
      </Box>,
      note !== null ? (
        <Box key="header-note-row" flexDirection="row" paddingLeft={2}>
          {note}
        </Box>
      ) : null,
      ...more,
    ]
  }
  const rows = [
    <Box key="header-claude-row" flexDirection="row">
      {whoOf(el, w, act)}
      {spacer(el, 'header-claude-gap')}
      {changedOf(el, w)}
    </Box>,
  ]
  if (note !== null || (counts.length > 0 && !w.isCountsOwnRow)) {
    rows.push(
      <Box key="header-step-row" flexDirection="row" paddingLeft={2}>
        {note}
        {!w.isCountsOwnRow && counts}
      </Box>,
    )
  }
  rows.push(...more)
  if (w.isCountsOwnRow && counts.length > 0) {
    rows.push(
      <Box key="header-counts-row" flexDirection="row" paddingLeft={2}>
        {counts}
      </Box>,
    )
  }
  return rows
}

/** The third row: which model the chat is on, dim when it is the Manager model or unknown; when not, normal text and the two buttons beside it (below 56 cells, on a row of their own). */
function modelRows(el: Els, w: HeaderWords, act: HeaderActions) {
  const { Box, Text, Button } = el
  const m = w.model
  if (m === null) return null
  const line = (
    <Box key="header-model-text" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
      <Text {...(m.isDim ? { dimColor: true } : {})} wrap="truncate-end">
        {m.text}
      </Text>
    </Box>
  )
  if (m.kind !== 'differs') {
    return (
      <Box key="header-model-row" flexDirection="row">
        {line}
      </Box>
    )
  }
  const buttons = (
    <Box key="header-model-buttons" flexShrink={0} flexDirection="row" columnGap={2} marginLeft={m.isButtonsOwnRow ? 0 : 2}>
      <Button key="header-model-copy" plain label={m.copyLabel} onPress={() => act.copyModel()} />
      {m.keepLabel !== '' && <Button key="header-model-keep" plain label={m.keepLabel} onPress={() => act.keepModel()} />}
    </Box>
  )
  if (m.isButtonsOwnRow) {
    return [
      <Box key="header-model-row" flexDirection="row">
        {line}
      </Box>,
      <Box key="header-model-buttons-row" flexDirection="row">
        {buttons}
      </Box>,
    ]
  }
  return (
    <Box key="header-model-row" flexDirection="row">
      {line}
      {buttons}
    </Box>
  )
}

export function headerTree(el: Els, props: HeaderProps, columns: number, act: HeaderActions) {
  const { Box, Text } = el
  const w = headerWords(props, columns)
  return (
    <Box key="header" flexDirection="column" paddingX={2} marginBottom={1}>
      {youRow(el, w, act)}
      {w.attention.total > 0 && w.attention.kinds !== '' && !w.isKindsBeside && (
        <Box key="header-kinds-row" flexShrink={1} minWidth={0} overflow="hidden">
          <Text dimColor wrap="truncate-end">
            {w.attention.kinds}
          </Text>
        </Box>
      )}
      {claudeRows(el, w, act)}
      {modelRows(el, w, act)}
    </Box>
  )
}
