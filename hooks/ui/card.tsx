// The open card's view (KB-0024 step 2: moved out of hooks/register.tsx unchanged). A plain top-level function: the elements, the
// card's model and the press handlers come in as arguments.
import type { EngineInterface } from 'claude-code'

import type { KanbanSnapshot } from '../../types'
import type { CardView as CardModel, StatusBox } from '../lib/cardview.ts'
import { LOG_COPY_ALL, LOG_COPY_COMMAND } from '../lib/strings.ts'

type Els = ReturnType<EngineInterface['ui']['resolve']>

/** The surface fill of a status box (spec 1). */
const SURFACE = 'userMessageBackground'
/** The words under the open card's Model and Thinking Selects for "no choice": the first option of each. */
const AUTO = 'Auto'
/** Below this many cells the three groups (Lane; Model and Thinking; Type) stack, and Model and Thinking stack inside theirs. */
const NARROW = 60
/** From this many cells the three groups stand in one row; between NARROW and this, Lane and Type share a row with Model and Thinking under them. */
const WIDE = 90
/** The headings over the three groups of Selects (bold, small; the outlines carry the rest). */
const HEAD_LANE = 'Lane (move it)'
const HEAD_CLAUDE = 'Claude runs it with'
const HEAD_TYPE = 'Card type'

/** The Auto choice: its value is `Auto` (what the pane writes as "no choice"), its words carry the board's default. */
function autoOption(words: string): { value: string; label: string } {
  return { value: AUTO, label: words === '' ? AUTO : `${AUTO} (${words})` }
}

/** What a press on the open card does. */
export type CardActions = {
  select: (id: string | null) => void
  /** Opens the previous (-1) or next (1) card in the order the board shows them. */
  step: (dir: -1 | 1) => void
  move: (id: string, from: string, to: string) => void
  /** A flag box button: the same move, then the card closes and the lanes show. A refused press leaves the card open. */
  approve: (id: string, from: string, to: string) => void
  set: (id: string, field: 'model' | 'thinking', choice: string) => void
  /** The Type list picked a type name: only held, nothing is written or asked. Picking the card's own type puts the pick away. */
  pickType: (name: string) => void
  /** `Retype` on the question row: asks Claude to retype the card as this type. */
  confirmedRetype: (id: string, type: string) => void
  /** `Cancel` on the question row: the list goes back to the card's real type. */
  cancelRetype: () => void
  showLog: () => void
  typeComment: (value: string) => void
  comment: (id: string, value: string) => void
  confirmedDelete: (id: string) => void
  setConfirm: (isAsking: boolean) => void
  copy: (id: string) => void
  /** A press on a Log line's date: puts the whole line (date, time, name, words) on the clipboard. */
  copyLine: (text: string) => void
  /** `Copy entire log`: puts every Log line, the hidden ones too, on the clipboard. */
  copyLog: (text: string) => void
  /** A Log line's `Copy command`: puts one stretch the line had between backticks on the clipboard. */
  copyCommand: (text: string) => void
  /** Opens (true) or closes (false) the Rename field; opening starts it with the card's title. */
  setRenaming: (isOpen: boolean) => void
  typeRename: (value: string) => void
  /** Shows (true) or hides (false) every plan step in full. */
  setDetails: (isOpen: boolean) => void
  rename: (id: string, value: string) => void
}

/** Everything the open card draws, worked out by the pane. */
export type CardProps = {
  snap: KanbanSnapshot
  view: CardModel
  description: string
  box: StatusBox | null
  moveValues: string[]
  options: (values: readonly string[]) => { value: string }[]
  modelWords: readonly string[]
  /** The Thinking Select's choices for the card's effective model (value written, label shown), Not set left out. */
  thinkingOptions: { value: string; label: string }[]
  ownModel: string
  ownThinking: string
  pinText: string
  autoLine: string
  /** What `Auto` stands for on this card (the model and the thinking the board's settings give it; thinking '' when Not set): the Auto choice reads `Auto (sonnet)`. */
  autoModel: string
  autoThinking: string
  /** The pane's width in cells: from WIDE the three groups of Selects stand in one row, from NARROW Lane and Type share a row, below that one under the other. */
  columns: number
  comment: string
  confirmDelete: boolean
  /** The type picked in the Type list and not yet asked for ('' = none). */
  retypePick: string
  /** The Rename field: whether it is open and the title typed in it. */
  renaming: { isOpen: boolean; title: string }
  /** `Show details` is on: every plan step is drawn in full, not only the step in hand. */
  showDetails: boolean
  /** Where the card stands among the cards the board shows (1-based), or null when it is not among them (Find hides it). */
  step: { at: number; total: number } | null
}

export function cardTree(el: Els, p: CardProps, act: CardActions) {
  const { Box, Text, Input, Select, Button, Markdown } = el
  const { snap, view, box, moveValues, options, ownModel, ownThinking, pinText, autoLine, comment, confirmDelete, renaming } = p
  const isNarrow = p.columns < NARROW
  const isWide = p.columns >= WIDE
  // The question shows while a type other than the card's own is picked.
  const isAsking = p.retypePick !== '' && p.retypePick !== view.typeValue
  const typeBox = (
    <Box key="card-type-box" flexGrow={1} flexShrink={1} minWidth={0}>
      <Select
        key="card-type"
        label="Type"
        options={options(view.typeOptions)}
        value={p.retypePick !== '' ? p.retypePick : view.typeValue}
        onSelect={(v: string) => act.pickType(v)}
      />
    </Box>
  )
  const moveBox = (
    <Box key="card-move-box" flexGrow={1} flexShrink={1} minWidth={0}>
      <Select
        key="card-move"
        label="Lane"
        options={options(moveValues)}
        value={view.moveTo.value}
        onSelect={(v: string) => act.move(view.id, view.lane, v)}
      />
    </Box>
  )
  const modelBox = (
    <Box key="card-model-box" flexGrow={1} flexShrink={1} minWidth={0}>
      <Select
        key="card-model"
        label="Model"
        options={[autoOption(p.autoModel), ...options(p.modelWords)]}
        value={ownModel === '' ? AUTO : ownModel}
        onSelect={(v: string) => act.set(view.id, 'model', v)}
      />
    </Box>
  )
  const thinkingBox = (
    <Box key="card-thinking-box" flexGrow={1} flexShrink={1} minWidth={0}>
      <Select
        key="card-thinking"
        label="Thinking"
        options={[autoOption(p.autoThinking), ...p.thinkingOptions]}
        value={ownThinking === '' ? AUTO : ownThinking}
        onSelect={(v: string) => act.set(view.id, 'thinking', v)}
      />
    </Box>
  )
  // Each group is a bold heading over a round outline: bright for Lane (the action), dim for the other two. No colour is added.
  const laneGroup = (
    <Box key="card-group-lane" flexDirection="column" flexGrow={isWide ? 0 : 1} flexShrink={1} minWidth={0}>
      <Text bold wrap="truncate-end">{HEAD_LANE}</Text>
      <Box borderStyle="round" borderDimColor={false} flexDirection="row" paddingX={1}>
        {moveBox}
      </Box>
    </Box>
  )
  const claudeGroup = (
    <Box key="card-group-claude" flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
      <Text bold wrap="truncate-end">{HEAD_CLAUDE}</Text>
      <Box borderStyle="round" borderDimColor flexDirection="column" paddingX={1}>
        <Box key="card-claude-lists" flexDirection={isNarrow ? 'column' : 'row'} columnGap={2}>
          {modelBox}
          {thinkingBox}
        </Box>
        <Box key="card-model-line" flexDirection="row">
          {pinText === '' ? (
            <Text dimColor wrap="truncate-end">
              {`Auto: Settings decide. ${autoLine.charAt(0).toUpperCase()}${autoLine.slice(1)}.`}
            </Text>
          ) : (
            <Box flexDirection="row">
              <Text bold wrap="truncate-end">
                {`Set on this card: ${pinText}.`}
              </Text>
              <Text dimColor wrap="truncate-end">
                {'  It stays with the card until you choose Auto or the card is done.'}
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
  const typeGroup = (
    <Box key="card-group-type" flexDirection="column" flexGrow={isWide ? 0 : 1} flexShrink={1} minWidth={0}>
      <Text bold wrap="truncate-end">{HEAD_TYPE}</Text>
      <Box borderStyle="round" borderDimColor flexDirection="row" paddingX={1}>
        {typeBox}
      </Box>
    </Box>
  )
  // The suggestion and the retype question belong to the Type group: they stand directly under it (under the row that holds it when
  // the group shares a row), before anything else.
  const typeNotes = [
    !snap.isReadOnly && view.suggestion !== null && (
      <Box key="card-suggestion" flexShrink={1} minWidth={0}>
        <Text dimColor wrap="wrap">
          {view.suggestion.text}
        </Text>
      </Box>
    ),
    isAsking && (
      <Box key="card-retype-ask" marginTop={1} flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text>{`Retype ${view.id} as ${p.retypePick}? Its ID will change.`}</Text>
        <Button
          key="card-retype-yes"
          label="Retype"
          onPress={() => {
            act.confirmedRetype(view.id, p.retypePick)
          }}
        />
        <Button
          key="card-retype-no"
          label="Cancel"
          onPress={() => {
            act.cancelRetype()
          }}
        />
      </Box>
    ),
  ]
  return (
      <Box key="card" flexDirection="column" marginX={2}>
        <Box key="card-panel" flexDirection="column">
          <Box key="card-titlebar" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1} paddingX={1}>
            <Button
              key="card-back"
              label={'◂ Board'}
              plain
              onPress={() => {
                act.select(null)
              }}
            />
            <Box key="card-header" flexShrink={1}>
              <Text dimColor wrap="truncate-end">
                {`${view.id}${view.formerId === null ? '' : ` (was ${view.formerId})`}  in ${view.lane}`}
              </Text>
            </Box>
            <Box key="card-titlebar-gap" flexGrow={1} />
            {p.step !== null && (
              <Box key="card-step" flexShrink={0} flexDirection="row" columnGap={1}>
                {p.step.at > 1 ? (
                  <Button key="card-prev" label="◂ Prev" plain onPress={() => act.step(-1)} />
                ) : (
                  <Text key="card-prev-end" dimColor>
                    ◂ Prev
                  </Text>
                )}
                <Text key="card-step-count" dimColor>{`${p.step.at} of ${p.step.total}`}</Text>
                {p.step.at < p.step.total ? (
                  <Button key="card-next" label="Next ▸" plain onPress={() => act.step(1)} />
                ) : (
                  <Text key="card-next-end" dimColor>
                    Next ▸
                  </Text>
                )}
              </Box>
            )}
          </Box>
          <Box key="card-body" flexDirection="column" paddingX={1}>
            {renaming.isOpen && !snap.isReadOnly ? (
              <Box key="card-rename-row" marginTop={1} flexDirection="row" alignItems="center" columnGap={1}>
                <Box key="card-rename-field" flexShrink={1} minWidth={0}>
                  <Input
                    key="card-rename"
                    placeholder="Card title"
                    value={renaming.title}
                    submitLabel="Save"
                    onInput={(value: string) => {
                      act.typeRename(value)
                    }}
                    onSubmit={(value: string) => {
                      act.rename(view.id, value)
                    }}
                  />
                </Box>
                <Box key="card-rename-cancel-box" flexShrink={0}>
                  <Button
                    key="card-rename-cancel"
                    label="Cancel"
                    plain
                    onPress={() => {
                      act.setRenaming(false)
                    }}
                  />
                </Box>
              </Box>
            ) : (
              <Box key="card-title" marginTop={1} flexShrink={1} minWidth={0}>
                <Text bold wrap="wrap">
                  {view.title}
                </Text>
              </Box>
            )}
            <Box key="card-tools" flexDirection="row" columnGap={2} flexWrap="wrap">
              {!snap.isReadOnly && !renaming.isOpen && (
                <Box key="card-rename-open-box" flexShrink={0}>
                  <Button
                    key="card-rename-open"
                    label="Rename"
                    plain
                    dimColor
                    onPress={() => {
                      act.setRenaming(true)
                    }}
                  />
                </Box>
              )}
              <Box key="card-copy-box" flexShrink={0}>
                <Button
                  key="card-copy"
                  label="Copy ID"
                  plain
                  dimColor
                  onPress={() => {
                    act.copy(view.id)
                  }}
                />
              </Box>
            </Box>
            {box !== null && (
              <Box
                key="card-box"
                marginTop={1}
                flexDirection="column"
                paddingX={2}
                paddingY={1}
                backgroundColor={SURFACE}
              >
                {box.kind === 'waiting' && (
                  <Box key="card-flag" flexDirection="column">
                    <Text bold color={box.colour} wrap="wrap">
                      {`${box.glyph} ${box.text}`}
                    </Text>
                    {!snap.isReadOnly && box.buttons.length > 0 && (
                      <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
                        {box.buttons.map((b) => (
                          <Button
                            key={`card-flag-${b.key}`}
                            label={b.label}
                            variant={b.key}
                            onPress={() => act.approve(view.id, view.lane, b.to)}
                          />
                        ))}
                      </Box>
                    )}
                    {box.hint !== null && <Text dimColor>{box.hint}</Text>}
                  </Box>
                )}
                {box.kind === 'queued' && (
                  <Box key="card-queued" flexDirection="column">
                    <Text bold color="claude" wrap="wrap">
                      {box.title}
                    </Text>
                    <Text wrap="wrap">{box.lines[0] ?? ''}</Text>
                    <Text dimColor wrap="wrap">
                      {box.lines[1] ?? ''}
                    </Text>
                  </Box>
                )}
                {box.kind === 'working' && (
                  <Box key="card-working" flexDirection="column">
                    <Box flexDirection="row" alignItems="flex-start" columnGap={1}>
                      <Text bold color="claude">
                        {box.label}
                      </Text>
                      <Box flexShrink={1}>
                        <Text bold wrap="wrap">
                          {box.text}
                        </Text>
                      </Box>
                    </Box>
                    {box.bar !== null && (
                      <Box flexDirection="row" columnGap={1}>
                        <Text color="claude">{'▰'.repeat(box.bar.done)}</Text>
                        <Text dimColor>{'▱'.repeat(Math.max(0, box.bar.glyphs.length - box.bar.done))}</Text>
                        <Text>{box.progress ?? ''}</Text>
                      </Box>
                    )}
                    {box.last !== null && (
                      <Text dimColor wrap="wrap">
                        {box.last}
                      </Text>
                    )}
                    <Text dimColor wrap="wrap">
                      {box.branch}
                    </Text>
                  </Box>
                )}
                {box.kind === 'children' && (
                  <Box key="card-children" flexDirection="column">
                    <Text wrap="wrap">{box.text}</Text>
                    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                      {box.children.map((c) => (
                        <Box key={`card-child-box-${c.id}`} flexDirection="row" columnGap={1}>
                          {snap.cards.some((k) => k.id === c.id) ? (
                            <Button
                              key={`card-child-${c.id}`}
                              label={c.id}
                              plain
                              onPress={() => {
                                act.select(c.id)
                              }}
                            />
                          ) : (
                            <Text>{c.id}</Text>
                          )}
                          <Text dimColor>{c.isDone ? 'done' : c.lane === null ? '' : `in ${c.lane}`}</Text>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}
              </Box>
            )}
            {!snap.isReadOnly && (
              <Box key="card-selects-row" marginTop={1} flexDirection={isWide ? 'row' : 'column'} columnGap={2}>
                {isWide ? (
                  [laneGroup, claudeGroup, typeGroup]
                ) : isNarrow ? (
                  [laneGroup, claudeGroup, typeGroup, ...typeNotes]
                ) : (
                  [
                    <Box key="card-selects-top" flexDirection="row" columnGap={2}>
                      {laneGroup}
                      {typeGroup}
                    </Box>,
                    ...typeNotes,
                    claudeGroup,
                  ]
                )}
              </Box>
            )}
            {(snap.isReadOnly || isWide) && typeNotes}
            {view.plan !== null && (
              <Box key="card-plan" marginTop={2} flexDirection="column">
                <Box flexDirection="row" justifyContent="space-between">
                  <Text bold dimColor>Plan</Text>
                  <Text dimColor>{view.plan.count}</Text>
                </Box>
                {view.plan.rows.map((r) => (
                  <Box key={`card-step-${r.n}`} flexDirection="row" alignItems="flex-start" columnGap={1}>
                    <Box key={`card-step-mark-${r.n}`} width={2} flexShrink={0}>
                      {r.mark === 'hand' ? <Text color="claude">{r.glyph}</Text> : <Text dimColor>{r.glyph}</Text>}
                    </Box>
                    <Box key={`card-step-text-${r.n}`} flexGrow={1} flexShrink={1} minWidth={0}>
                      {r.mark === 'hand' ? (
                        <Box flexDirection="column" flexShrink={1} minWidth={0}>
                          <Text bold wrap="wrap">
                            {r.lead}
                          </Text>
                          {r.rest !== '' && (
                            <Text dimColor wrap="wrap">
                              {r.rest}
                            </Text>
                          )}
                          {p.showDetails && r.extra !== '' && (
                            <Text dimColor wrap="wrap">
                              {r.extra}
                            </Text>
                          )}
                        </Box>
                      ) : p.showDetails ? (
                        <Text dimColor wrap="wrap">
                          {r.text}
                        </Text>
                      ) : (
                        <Text dimColor wrap="truncate-end">
                          {r.summary}
                        </Text>
                      )}
                    </Box>
                  </Box>
                ))}
                {(p.showDetails || view.plan.rows.some((r) => (r.mark === 'hand' ? r.extra !== '' : r.text !== r.summary))) && (
                  <Box key="card-details-box" marginLeft={3} flexShrink={0}>
                    <Button
                      key="card-details"
                      label={p.showDetails ? 'Hide details' : 'Show details'}
                      plain
                      onPress={() => {
                        act.setDetails(!p.showDetails)
                      }}
                    />
                  </Box>
                )}
              </Box>
            )}
            {p.description !== '' && (
              <Box key="card-description" marginTop={2} flexDirection="column">
                <Text bold dimColor>Description</Text>
                <Markdown key="card-description-text" text={p.description} />
              </Box>
            )}
            <Box key="card-log" marginTop={2} flexDirection="column">
              <Box key="card-log-head" flexDirection="row" columnGap={2}>
                <Text bold dimColor>Log</Text>
                {view.log.total > 0 && (
                  <Box key="card-log-copy-all-box" flexShrink={0}>
                    <Button
                      key="card-log-copy-all"
                      label={LOG_COPY_ALL}
                      plain
                      dimColor
                      onPress={() => {
                        act.copyLog(view.log.all)
                      }}
                    />
                  </Box>
                )}
              </Box>
              {!snap.isReadOnly && (
                <Box key="card-comment-row">
                  <Input
                    key="card-comment"
                    placeholder={view.commentPlaceholder}
                    value={comment}
                    submitLabel="Comment"
                    onInput={(value: string) => {
                      act.typeComment(value)
                    }}
                    onSubmit={(value: string) => {
                      act.comment(view.id, value)
                    }}
                  />
                </Box>
              )}
              {[...view.log.lines].reverse().map((l, n) => (
                <Box key={`card-log-line-${n}`} flexDirection="row" alignItems="flex-start" columnGap={1}>
                  <Box key={`card-log-stamp-${n}`} width={15} flexShrink={0}>
                    <Button
                      key={`card-log-copy-stamp-${n}`}
                      label={l.stamp}
                      plain
                      dimColor
                      onPress={() => {
                        act.copyLine(l.line)
                      }}
                    />
                  </Box>
                  <Box key={`card-log-words-${n}`} flexDirection="column" flexShrink={1} minWidth={0}>
                    <Box key={`card-log-text-${n}`} flexShrink={1} minWidth={0}>
                      <Text wrap="wrap">{`${l.who}: ${l.text}`}</Text>
                    </Box>
                    {l.commands.length > 0 && (
                      <Box key={`card-log-tools-${n}`} flexDirection="row" flexWrap="wrap" columnGap={2}>
                        {l.commands.map((c, k) => (
                          <Box key={`card-log-cmd-box-${n}-${k}`} flexShrink={0}>
                            <Button
                              key={`card-log-cmd-${n}-${k}`}
                              label={l.commands.length > 1 ? `${LOG_COPY_COMMAND} ${k + 1}` : LOG_COPY_COMMAND}
                              plain
                              dimColor
                              onPress={() => {
                                act.copyCommand(c)
                              }}
                            />
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Box>
                </Box>
              ))}
              {view.log.showAll !== null && (
                <Button
                  key="card-log-all"
                  label={view.log.showAll}
                  plain
                  onPress={() => {
                    act.showLog()
                  }}
                />
              )}
            </Box>
            {!snap.isReadOnly &&
              (confirmDelete ? (
                <Box key="card-delete-ask" marginTop={2} flexDirection="row" flexWrap="wrap" columnGap={1}>
                  <Text color="error">{`Delete ${view.id}? This removes the card and its log.`}</Text>
                  <Button
                    key="card-delete-yes"
                    label="Delete it"
                    onPress={() => {
                      act.confirmedDelete(view.id)
                    }}
                  />
                  <Button
                    key="card-delete-no"
                    label="Keep it"
                    onPress={() => {
                      act.setConfirm(false)
                    }}
                  />
                </Box>
              ) : (
                <Box key="card-actions" marginTop={2} flexDirection="row">
                  <Box key="card-delete-box" flexShrink={0}>
                    <Button
                      key="card-delete"
                      label={'Delete card…'}
                      plain
                      dimColor
                      onPress={() => {
                        act.setConfirm(true)
                      }}
                    />
                  </Box>
                </Box>
              ))}
          </Box>
        </Box>
      </Box>
  )
}
