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
  prefix: string
  workers: number
  managerModel: string
  plannerModel: string
  workerModel: string
  advisorModel: string
  /** Thinking per role: low, medium, high, xhigh, max, or `none` (Not set). Absent in a snapshot saved before the Settings tab: read as the role's default. */
  managerThinking?: string
  plannerThinking?: string
  workerThinking?: string
  advisorThinking?: string
  /** Which settings lines board.md holds (a line equal to its default counts), so Reset and Restore know what to remove. Absent in an old snapshot: read as none. */
  saved?: string[]
  /** The board's effective defaults (its saved `default_` lines, else the built-in): what Reset and the Default text mean. Absent in an old snapshot: read as the built-in defaults. */
  defaults?: { workers: number; roles: { [role: string]: { model: string; thinking: string } } }
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
  /** The facts of its plan and Log; null when the file has none to give. Absent in an old snapshot. */
  facts?: KanbanFacts | null
  /** The card's own model and thinking level (an allowed word, or '' for Auto). Absent in a snapshot saved before the card fields: read as Auto. */
  model?: string
  thinking?: string
}

/** One file the board could not use: unreadable, unparsable, an unknown lane, a duplicate ID. */
export type KanbanBad = { file: string; reason: string }

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
  /** 'move': a card dropped in a lane; 'create': a card made in a lane that has an action; 'delete': asked to be deleted. */
  kind: 'move' | 'create' | 'delete'
  /** The prompt text, to match turn.start against. */
  text: string
  /** Milliseconds since the epoch. */
  at: number
}

/** One running or pending agent whose description starts with a card ID. */
export type KanbanWorking = { id: string; description: string }

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
      /** The card the running turn is about, when it began with a move prompt from the pane. */
      turnCard: string | null
      queued: KanbanQueued[]
      /** The card ID whose view takes the place of the lanes; null: the lanes. Cleared when the card goes. */
      selected: string | null
      /** The text typed in the card view's comment box. Emptied when the card changes. */
      comment: string
      /** The chosen tab of the header band; the Settings tab takes the lanes' place. */
      tab: 'board' | 'settings'
      /** Minutes since the epoch, bumped by the tick when the minute changes, so times that read the clock redraw. */
      minute: number
      /** Whether the open card shows the whole log (else the newest 6 lines). Reset when the card changes. */
      showLog: boolean
      /** Whether the open card's Plan shows every step in full (Show details), else only the step in hand. Reset when the card changes. */
      showDetails: boolean
      /** Whether the card view's last row asks `Delete KB-0015?` in place of the two buttons. Reset when the card changes. */
      confirmDelete: boolean
      /** The open card's Rename field: whether it is open and the title typed in it. Reset when the card changes. */
      renaming: { isOpen: boolean; title: string }
      /** Whether the Settings tab's top row asks `Put every setting back to its default?` in place of Restore all defaults. Closed by Keep, Restore and any change of tab. */
      confirmRestore: boolean
      /** What he folded and opened on the lanes, kept so a card view that takes the lanes' place does not lose it. */
      lanesView: KanbanLanesView
      /** Whether the Settings tab's `Restore original defaults` is asking its question in place. */
      confirmOriginal: boolean
      /** How many times the Settings tab was chosen: it is added to the view's stamp the Client is handed, so the Client drops what is open on it (the small card menu) even though its saved state outlives a remount. */
      tabChanges: number
      /** The Find field's text. Cleared when the session starts. */
      find: string
      /** The toolbar's New card row: whether it is open, the title typed, and the lane picked ('' = the first intake lane). Cleared by Cancel. */
      add: { isOpen: boolean; title: string; lane: string }
      /** Whether the Kanban pane is shown (set on each open, cleared on its close); null until known, then the engine's own list says. The Board chip above the chat box shows while it is false. */
      paneShown: boolean | null
    }
  }
}

