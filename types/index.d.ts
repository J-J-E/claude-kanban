// The state contract of the kanban plugin: what hooks/register.tsx keeps in $.state and the pane draws from.
// Self-contained (no imports); every exported name leads with Kanban.

/** One lane of kanban/board.md, in board order. `role` is the lane's role word, e.g. 'auto'. */
export type KanbanLane = {
  label: string
  role: string
  /** Drawn on the side strip; no effect on behaviour. */
  isSide: boolean
  /** Only Claude may move a card in (roles needs-you and gated). */
  isClaudeOnly: boolean
}

/** The settings lines of board.md, as the pane shows them. */
export type KanbanSettings = {
  owner: string
  /** The board's ticket types in order, as board.md lists them. Absent in a snapshot saved before types: read as the library's default types. */
  types?: { name: string; prefix: string }[]
  workers: number
  /** Whether each Needs You card is put to the owner in chat (`needs_you_in_chat: on`). Absent in an old snapshot: off. */
  needsYouInChat?: boolean
  /** Who merges a card's pull request (`merge_by`: `claude` or `owner`). Absent in an old snapshot: `claude`. */
  mergeBy?: string
  managerModel: string
  plannerModel: string
  workerModel: string
  /** Thinking per role: low, medium, high, xhigh, max, or `none` (Not set). Absent in a snapshot saved before the Settings tab: read as the role's default. */
  managerThinking?: string
  plannerThinking?: string
  workerThinking?: string
  /** Which settings lines board.md holds (a line equal to its default counts), so Reset and Restore know what to remove. Absent in an old snapshot: read as none. */
  saved?: string[]
  /** The board's effective defaults (its saved `default_` lines, else the built-in): what Reset and the Default text mean. Absent in an old snapshot: read as the built-in defaults. */
  defaults?: { workers: number; needsYouInChat?: boolean; mergeBy?: string; roles: { [role: string]: { model: string; thinking: string } } }
  /** Which `default_` keys board.md holds. Absent in an old snapshot: read as none. */
  savedDefaults?: string[]
}

/** What a card file says about its progress (hooks/lib/status.ts cardFacts), kept compact: step texts are the short phrase, a Log text is cut. */
export type KanbanFacts = {
  /** The numbered steps of `## Plan`; `text` and `short` both hold the short phrase. */
  steps: { n: number; text: string; short: string }[]
  total: number
  done: number
  retry: { n: number; of: number; text: string } | null
  last: { date: string; time: string; who: string; text: string } | null
  waitingOn: string[]
  /** True when a `Claude: started` Log line comes after the newest `moved` line. Absent in a snapshot saved before ENH-0063: read as false. */
  started?: boolean
  /** The text after `waiting on` in the newest `Claude:` Log line, null when that line is not a wait. Absent in an old snapshot: read as null. */
  waitThing?: string | null
}

/** One card file that parsed. */
export type KanbanCard = {
  id: string
  title: string
  /** The status line as written, usually a lane label. */
  status: string
  order: number
  flag: string
  /** YYYY-MM-DD */
  updated: string
  /** The file name inside kanban/. The pane's only source of a path; it never comes from a message. */
  file: string
  /** The card's labels. Absent in a snapshot saved before the header band: read as none. */
  labels?: string[]
  /** The `branch:` and `pr:` lines ('' when empty). Absent in an old snapshot. */
  branch?: string
  pr?: string
  /** The `parent:` line (a card ID, or '' when empty). Absent in an old snapshot: read as none. */
  parent?: string
  /** The facts of its plan and Log; null when the file has none to give. Absent in an old snapshot. */
  facts?: KanbanFacts | null
  /** The card's own model and thinking level (an allowed word, or '' for Auto). Absent in a snapshot saved before the card fields: read as Auto. */
  model?: string
  thinking?: string
  /** The NAME of the card's type, read from the letters of its ID; absent when the letters are no type on the board. Absent in an old snapshot. */
  type?: string
  /** Old IDs from the Log's `retyped from <A> to <B>` lines, oldest first. Absent in an old snapshot: read as none. */
  formerIds?: string[]
  /** `YYYY-MM-DD HH:MM` the card was made (sorts as text). Absent in an old snapshot. */
  createdAt?: string
}

/** One file the board could not use: unreadable, unparsable, an unknown lane, a duplicate ID. */
export type KanbanBad = {
  file: string
  reason: string
  /** The problem's format.md section 12 code; `unreadable` for a file that could not be read at all. Absent in an old snapshot, and then read as `unreadable`. */
  code?: string
}

/** Everything read from kanban/, as of the last poll that found a change. */
export type KanbanSnapshot = {
  /** False when kanban/board.md does not exist. */
  hasBoard: boolean
  /** True when board.md is unreadable: the last good lanes and settings are kept and no move is accepted. */
  isReadOnly: boolean
  lanes: KanbanLane[]
  settings: KanbanSettings
  cards: KanbanCard[]
  bad: KanbanBad[]
  /** File name to [mtimeMs, size] for board.md and every card file seen. */
  files: { [name: string]: [number, number] }
  /** Bumped on every change; the board Client echoes it back with a move. */
  rev: number
  /** Milliseconds since the epoch of the last change. */
  changedAt: number
}

/** A prompt the pane submitted that has not started its turn yet. */
export type KanbanQueued = {
  /** The card the prompt is about. */
  id: string
  /** 'move': a card dropped in a lane; 'create': a card made in a lane that has an action; 'delete': asked to be deleted; 'retype': asked to be given another type (a new ID); 'merge': asked to be merged into another card (this is the card that goes away). */
  kind: 'move' | 'create' | 'delete' | 'retype' | 'merge' | 'resume'
  /** The prompt text, to match turn.start against. */
  text: string
  /** Milliseconds since the epoch. */
  at: number
}

/** One running or pending agent whose description starts with a card ID. */
export type KanbanWorking = { id: string; description: string; /** When the pane first saw the agent in its present status (ms), for an agent between steps. */ since?: number; /** The app's status of a between-steps agent: idle or completed. */ status?: string; /** The app's id of a between-steps agent, for the manager note. */ agentId?: string }

/** What he folded and opened on the lanes: lane name to his fold choice, lane name to true when its `+ N more` is open, and the one sort of the whole board (`boardSort`, a sort key of hooks/lib/sort.ts; absent is Your order). A sort is a view: it is kept here and never written to a card. */
export type KanbanLanesView = {
  fold: { [lane: string]: { isOpen: boolean; flagged: number } }
  more: { [lane: string]: boolean }
  /** The board's one sort. Absent: Your order. */
  boardSort?: string
  /** Bumped by the toolbar's Collapse all and Expand all: the board Client takes up `fold` again whenever the stamp it last saw differs. Absent: 0. */
  stamp?: number
}

declare module 'claude-code' {
  interface PluginState {
    kanban: {
      snapshot: KanbanSnapshot | null
      /** One entry per running or pending agent (its description starts with the card ID, kept beside it), so a card with two agents appears twice. */
      working: KanbanWorking[]
      /** One entry per idle or completed agent (between steps): a worker that finished and may be resumed by message, with `since` set. */
      between: KanbanWorking[]
      /** The card the running turn is about, when it began with a move prompt from the pane. */
      turnCard: string | null
      /** True from any main-session turn start to its turn.complete (a chat turn has no card): Claude is busy. */
      inTurn: boolean
      /** The model the chat is really on, as the engine names it ('' = not known); the pane says it and never switches it. */
      chatModel: string
      /** True once the chat has been asked to run /compact (hooks/lib/hygiene.ts): the message comes once per chat; cleared when a session starts. */
      chatWarned: boolean
      queued: KanbanQueued[]
      /** The card ID whose view takes the place of the lanes; null: the lanes. Cleared when the card goes. */
      selected: string | null
      /** The chosen tab of the header band; the Settings tab takes the lanes' place. */
      tab: 'board' | 'settings'
      /** Minutes since the epoch, bumped by the tick when the minute changes, so times that read the clock redraw. */
      minute: number
      /** Whether the open card shows the whole log (else the newest 6 lines). Reset when the card changes. */
      showLog: boolean
      /** Whether the open card's Plan shows every step in full (Show details), else only the step in hand. Reset when the card changes. */
      showDetails: boolean
      /** `Show all` is on: every list of card-file problems above the lanes is drawn in full. */
      showAllProblems: boolean
      /** Why the app could not draw the pane's board region (a ui.fault reason); the pane shows it with a Retry button. Null: nothing wrong. */
      fault: string | null
      /** Whether the card view's last row asks `Delete KB-0015?` in place of the two buttons. Reset when the card changes. */
      confirmDelete: boolean
      /** The pair a drop on another card asked to merge (`id` goes away into `onto`); the board tab asks about it until Merge or Keep both. Dropped when either card is gone or the tab changes. Null: no question. */
      mergeAsk: { id: string; onto: string } | null
      /** The type name picked in the open card's Type list and not yet asked for ('' = none); the question row `Retype KB-0015 as enhancement?` shows while it differs from the card's own type. Reset when the card changes. */
      retypePick: string
      /** Whether the open card's Rename field is open (the title typed in it is in the hooks module's own memory). Reset when the card changes. */
      renaming: { isOpen: boolean }
      /** Whether the Settings tab's top row asks `Put every setting back to its default?` in place of Restore all defaults. Closed by Keep, Restore and any change of tab. */
      confirmRestore: boolean
      /** What he folded and opened on the lanes, kept so a card view that takes the lanes' place does not lose it. */
      lanesView: KanbanLanesView
      /** Whether the Settings tab's `Restore original defaults` is asking its question in place. */
      confirmOriginal: boolean
      /** How many times the Settings tab was chosen: it is added to the view's stamp the Client is handed, so the Client drops what is open on it (the small card menu) even though its saved state outlives a remount. */
      tabChanges: number
      /** The Find text the cards are filtered by (the field's own text is in the hooks module's memory and reaches this a moment after typing stops). Cleared when the session starts. */
      find: string
      /** The toolbar's New card row: whether it is open, the lane picked ('' = the first intake lane) and the type picked, by name ('' = the board's first type); the title typed is in the hooks module's memory. Cleared by Cancel. `type` is absent in a state saved before types. */
      add: { isOpen: boolean; lane: string; type?: string }
      /** A count of the redraws asked for a text field changed by something other than typing (the field emptied after Add or Comment, Clear in Find); the pane's drawing reads it. */
      drafts: number
      /** Whether the Kanban pane is shown (set on each open, cleared on its close); null until known, then the engine's own list says. The Board chip above the chat box shows while it is false. */
      paneShown: boolean | null
    }
  }
}

