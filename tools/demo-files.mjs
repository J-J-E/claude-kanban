// The texts of the kanban demo project (see make-demo.mjs), as pure functions: no imports, so tests/demo.test.ts can
// load this file and check the output with the plugin's own parser. Follows skills/kanban/references/format.md.

const LANES = [
  'Needs You (needs-you)',
  'Pending (intake)',
  'Plan (plan)',
  'Auto (auto)',
  'Backlog (backlog)',
  'Done (done)',
  'Discarded (scrapped)',
]

const CARDS = [
  {
    id: 'KB-0001',
    slug: 'greet-a-person-by-name',
    title: 'Greet a person by name',
    body: [
      'hello.py should take a name on the command line and greet that person, for example "Hello, Sam!". The test should cover it.',
      '',
      'Open question: what should it say when no name is given?',
    ],
  },
  {
    id: 'KB-0002',
    slug: 'add-a-goodbye-function',
    title: 'Add a goodbye function',
    body: ['hello.py should also have a goodbye function that says goodbye to a person. The test should cover it.'],
  },
  {
    id: 'KB-0003',
    slug: 'format-the-greeting-with-a-colour-library',
    title: 'Format the greeting with a colour library',
    body: [
      'I want the greeting to print in colour. This needs a new dependency in requirements.txt, because it uses a third-party colour library.',
    ],
  },
]

const HELLO_PY = `def greet():
    return "Hello, world!"


if __name__ == "__main__":
    print(greet())
`

const TEST_HELLO_PY = `from hello import greet


def test_greet():
    assert greet() == "Hello, world!"
`

const README = `# Demo project
A tiny demo project for the kanban plugin. Open it in Claude Code and type /board.
`

const pad = (n) => String(n).padStart(2, '0')

/** Local date and time as the Log grammar wants them: { date: 'YYYY-MM-DD', time: 'HH:MM' }. */
export function localStamp(now = new Date()) {
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  }
}

export function ownerProblem(owner) {
  if (typeof owner !== 'string' || owner.trim() === '') return 'The owner name is empty.'
  if (/[\r\n]/.test(owner)) return 'The owner name must be one line.'
  if (/^["'[]/.test(owner.trim()) || owner !== owner.trim()) return 'The owner name must not start with a quote or [ or have edge spaces.'
  return undefined
}

/** Every file of the demo as { relativePath: text } (forward slashes, LF, trailing newline). */
export function demoFiles({ owner = 'You', stamp = localStamp() } = {}) {
  const problem = ownerProblem(owner)
  if (problem !== undefined) throw new Error(problem)
  const files = {
    'README.md': README,
    'hello.py': HELLO_PY,
    'test_hello.py': TEST_HELLO_PY,
    'kanban/DECISIONS.md': '# Decisions\n\n',
    'kanban/board.md':
      ['---', 'prefix: KB', `next_id: ${CARDS.length + 1}`, `owner: ${owner}`, 'lanes:', ...LANES.map((l) => '  - ' + l), '---', '# Board notes', '', 'Free text.'].join('\n') + '\n',
  }
  CARDS.forEach((c, i) => {
    const lines = [
      '---',
      `id: ${c.id}`,
      'status: Pending',
      `order: ${(i + 1) * 1000}`,
      `created: ${stamp.date}`,
      `updated: ${stamp.date}`,
      'flag:',
      'branch:',
      'pr:',
      'parent:',
      'labels: []',
      '---',
      `# ${c.title}`,
      '',
      ...c.body,
      '',
      '## Log',
      `- ${stamp.date} ${stamp.time} ${owner}: created in Pending`,
    ]
    files[`kanban/${c.id}-${c.slug}.md`] = lines.join('\n') + '\n'
  })
  return files
}
