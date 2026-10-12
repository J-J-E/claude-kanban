// The Settings tab (KB-0027 step 3), drawn from the normal tree's own elements like the header and the toolbar: flex rows of
// native controls, no outline and no filled bar. A role is one row, its name vertically centred on its two dropdowns (a Select
// reserves 2 rows, a Button 1); the two dropdowns share the room by flex. A row that differs from its default says what the
// default is and carries its `Reset`: beside the dropdowns from WIDE_FROM cells, else on a quiet line under them. A text that
// may not fit wraps or is cut in a Box that may shrink (docs/design/desktop-paint-notes.md rule 2); no Box that holds a Select or
// a Button has a numeric width. Nothing here has `$`: the presses are closures (hooks/register.tsx runs them).
import type { EngineInterface } from 'claude-code'

import {
  ADVISOR_THINKING_UNUSED,
  ALL_AT_DEFAULT,
  HEAD_DEFAULT,
  HEAD_MODEL,
  HEAD_THINKING,
  DEFAULTS,
  KEY_TITLE,
  NOTES,
  RESET,
  RESTORE_ALL,
  RESTORE_ORIGINAL,
  RESTORE_ORIGINAL_QUESTION,
  SAVE_DEFAULTS,
  ROLES,
  USAGE_NO_FIGURE,
  USAGE_SENTENCE,
  USAGE_ULTRACODE,
  WORKERS_LABEL,
  modelChoices,
  settingKey,
  settingsRows,
  thinkingChoices,
  workersChoices,
} from '../lib/settings.ts'
import type { Defaults, RoleRow, SettingsRow, SettingsTarget, SettingsValues, WorkersRow } from '../lib/settings.ts'

type Els = ReturnType<EngineInterface['ui']['resolve']>

/** From this many cells the default and its Reset sit beside the dropdowns; below, on the line under them. */
export const WIDE_FROM = 90
/** The cells every row's name takes: the longest is the Workers row's, so the dropdowns and the default column line up on every row. */
const NAME_W = WORKERS_LABEL.length
/**
 * The share of the row each dropdown's Box takes, in percent of the row (a share, not a cell count): the Boxes of a column must
 * start at the same place on every row whatever their dropdown says, and a Box sized by its own content does not (the desktop
 * sizes a Select by its value). The longest label, `medium (recommended)`, is in the second.
 */
const NARROW: { model: string; thinking: string } = { model: '30%', thinking: '50%' }
const WIDE: { model: string; thinking: string } = { model: '17%', thinking: '28%' }

/**
 * The share of the default cell (wide) or of the line under the dropdowns (narrow) the `Default: ...` text takes, so every
 * Reset starts at the same place whatever the default says; the text is cut with an ellipsis inside it.
 */
const DEFAULT_W_WIDE = '75%'
const DEFAULT_W_NARROW = '60%'

/** What a press on the Settings tab does: a Select, the Restore button, a Reset button. */
export type SettingsActions = {
  pick: (key: string, value: string) => void
  /** Restore all defaults, pressed in the question. */
  restore: () => void
  /** Opens (true) or closes (false) the question `Put every setting back to its default?`. */
  setConfirm: (isAsking: boolean) => void
  reset: (target: SettingsTarget) => void
  /** Save as defaults: acts at once. */
  saveDefaults: () => void
  /** Restore original defaults, pressed in the question. */
  restoreOriginal: () => void
  /** Opens (true) or closes (false) the question `Remove your saved defaults and put every setting back to the original?`. */
  setConfirmOriginal: (isAsking: boolean) => void
}

/** A Select in a Box that takes `grow` parts of the free room. */
function pickOf(el: Els, key: string, options: { value: string; label: string }[], value: string, share: string, act: SettingsActions) {
  const { Box, Select } = el
  return (
    <Box key={`settings-pick-${key}`} width={share} flexShrink={1} minWidth={0}>
      <Select key={`set-${key}`} options={options} value={value} onSelect={(v: string) => act.pick(key, v)} />
    </Box>
  )
}

/** `Default: opus, extra thinking` with its `Reset`, quiet; the text is cut with an ellipsis before the button ever is. */
function defaultOf(el: Els, row: SettingsRow, textWidth: string, act: SettingsActions) {
  const { Box, Text, Button } = el
  return [
    <Box key={`settings-default-${row.target}`} width={textWidth} flexShrink={1} minWidth={0} overflow="hidden">
      <Text dimColor wrap="truncate-end">
        {`${HEAD_DEFAULT}: ${row.defaultText}`}
      </Text>
    </Box>,
    <Box key={`settings-reset-box-${row.target}`} flexShrink={0}>
      <Button key={`reset-${row.target}`} plain label={RESET} onPress={() => act.reset(row.target)} />
    </Box>,
  ]
}

/** The line under the dropdowns of a row that differs (narrow), lined up with the first dropdown. */
function defaultLine(el: Els, row: SettingsRow, gap: number, act: SettingsActions) {
  const { Box } = el
  return (
    <Box key={`settings-default-line-${row.target}`} flexDirection="row" alignItems="center" columnGap={2} paddingLeft={NAME_W + gap}>
      {defaultOf(el, row, DEFAULT_W_NARROW, act)}
    </Box>
  )
}

function workersRow(el: Els, row: WorkersRow, isWide: boolean, gap: number, act: SettingsActions) {
  const { Box, Text } = el
  const share = isWide ? WIDE : NARROW
  return (
    <Box key="settings-workers" flexDirection="column">
      <Box key="settings-workers-line" flexDirection="row" alignItems="center" columnGap={gap}>
        <Box key="settings-workers-name" width={NAME_W} flexShrink={0}>
          <Text>{row.label}</Text>
        </Box>
        {pickOf(el, 'workers', workersChoices(), String(row.value), share.model, act)}
        <Box key="settings-workers-skip" width={share.thinking} flexShrink={1} minWidth={0} />
        <Box key="settings-workers-room" flexGrow={1} flexShrink={1} minWidth={0}>
          {isWide && row.differs && (
            <Box key="settings-workers-default" flexDirection="row" alignItems="center" columnGap={2} flexGrow={1} minWidth={0}>
              {defaultOf(el, row, DEFAULT_W_WIDE, act)}
            </Box>
          )}
        </Box>
      </Box>
      {!isWide && row.differs && defaultLine(el, row, gap, act)}
    </Box>
  )
}

function roleRow(el: Els, row: RoleRow, isWide: boolean, gap: number, act: SettingsActions) {
  const { Box, Text } = el
  const share = isWide ? WIDE : NARROW
  const role = row.target
  const noThinking = role === 'advisor' && row.model === 'none'
  return (
    <Box key={`settings-role-${role}`} flexDirection="column" marginTop={1}>
      <Box key={`settings-role-line-${role}`} flexDirection="row" alignItems="center" columnGap={gap}>
        <Box key={`settings-name-${role}`} width={NAME_W} flexShrink={0}>
          <Text>{row.label}</Text>
        </Box>
        {pickOf(el, settingKey(role, 'model'), modelChoices(role), row.model, share.model, act)}
        {noThinking ? (
          <Box key="settings-thinking-unused" width={share.thinking} flexShrink={1} minWidth={0}>
            <Text dimColor>{ADVISOR_THINKING_UNUSED}</Text>
          </Box>
        ) : (
          pickOf(el, settingKey(role, 'thinking'), thinkingChoices(row.model), row.thinking, share.thinking, act)
        )}
        {isWide && (
          <Box key={`settings-default-cell-${role}`} flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row" alignItems="center" columnGap={2}>
            {row.differs && defaultOf(el, row, DEFAULT_W_WIDE, act)}
          </Box>
        )}
      </Box>
      {!isWide && row.differs && defaultLine(el, row, gap, act)}
    </Box>
  )
}

/** A wrapping paragraph of quiet text. */
function paragraph(el: Els, key: string, text: string, marginTop: number) {
  const { Box, Text } = el
  return (
    <Box key={key} flexShrink={1} minWidth={0} marginTop={marginTop}>
      <Text dimColor>{text}</Text>
    </Box>
  )
}

/** The Settings tab's tree for the values the board holds, at `columns` cells wide. */
export function settingsTree(
  el: Els,
  values: SettingsValues,
  columns: number,
  act: SettingsActions,
  isAsking: boolean,
  defaults: Defaults = DEFAULTS,
  hasSaved = false,
  isAskingOriginal = false,
  chatLine = '',
) {
  const { Box, Text, Button } = el
  const rows = settingsRows(values, defaults)
  const workers = rows[0] as WorkersRow
  const roles = rows.slice(1) as RoleRow[]
  const differs = rows.some((r) => r.differs)
  const isWide = columns >= WIDE_FROM
  const share = isWide ? WIDE : NARROW
  const gap = columns >= 56 ? 2 : 1
  return (
    <Box key="settings" flexDirection="column" paddingX={2} marginBottom={1}>
      <Box key="settings-status" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={2}>
        {differs && isAsking ? (
          <Box key="settings-restore-ask" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1} flexShrink={1} minWidth={0}>
            <Text>Put every setting back to its default?</Text>
            <Button key="restore-yes" label="Restore" onPress={() => act.restore()} />
            <Button key="restore-no" label="Keep" onPress={() => act.setConfirm(false)} />
          </Box>
        ) : hasSaved && isAskingOriginal ? (
          <Box key="settings-original-ask" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1} flexShrink={1} minWidth={0}>
            <Text>{RESTORE_ORIGINAL_QUESTION}</Text>
            <Button key="original-yes" label="Restore" onPress={() => act.restoreOriginal()} />
            <Button key="original-no" label="Keep" onPress={() => act.setConfirmOriginal(false)} />
          </Box>
        ) : (
          [
            differs ? (
              <Box key="settings-restore-box" flexShrink={0}>
                <Button key="restore-all" label={RESTORE_ALL} onPress={() => act.setConfirm(true)} />
              </Box>
            ) : (
              <Box key="settings-all-default" flexShrink={1} minWidth={0}>
                <Text dimColor>{ALL_AT_DEFAULT}</Text>
              </Box>
            ),
            differs && (
              <Box key="settings-save-box" flexShrink={0}>
                <Button key="save-defaults" label={SAVE_DEFAULTS} onPress={() => act.saveDefaults()} />
              </Box>
            ),
            hasSaved && (
              <Box key="settings-original-box" flexShrink={0}>
                <Button key="restore-original" label={RESTORE_ORIGINAL} onPress={() => act.setConfirmOriginal(true)} />
              </Box>
            ),
          ]
        )}
      </Box>
      <Box key="settings-workers-block" flexDirection="column" marginTop={1}>
        {workersRow(el, workers, isWide, gap, act)}
      </Box>
      <Box key="settings-captions" flexDirection="row" columnGap={gap} marginTop={1}>
        <Box key="settings-caption-name" width={NAME_W} flexShrink={0} />
        <Box key="settings-caption-model" width={share.model} flexShrink={1} minWidth={0}>
          <Text dimColor>{HEAD_MODEL}</Text>
        </Box>
        <Box key="settings-caption-thinking" width={share.thinking} flexShrink={1} minWidth={0}>
          <Text dimColor wrap="truncate-end">
            {HEAD_THINKING}
          </Text>
        </Box>
        
      </Box>
      {ROLES.map((role) => roleRow(el, roles.find((r) => r.target === role) as RoleRow, isWide, gap, act))}
      <Box key="settings-usage" flexDirection="column" marginTop={2}>
        <Text>{KEY_TITLE}</Text>
        {paragraph(el, 'settings-usage-max', USAGE_SENTENCE, 0)}
        {paragraph(el, 'settings-usage-none', USAGE_NO_FIGURE, 0)}
        {paragraph(el, 'settings-usage-ultracode', USAGE_ULTRACODE, 0)}
      </Box>
      <Box key="settings-notes" flexDirection="column" marginTop={1}>
        {NOTES.map((note, n) => paragraph(el, `settings-note-${n}`, note, n === 0 ? 0 : 1))}
        {chatLine !== '' && paragraph(el, 'settings-chat-model', chatLine, 1)}
      </Box>
    </Box>
  )
}
