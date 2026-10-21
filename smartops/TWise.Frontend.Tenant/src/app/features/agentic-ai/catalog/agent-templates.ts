import { AgentCustomTool, AgentInput, AgentOutput, AgentStep, AgentTool, AgentType, SaveAgentRequest } from '../agents.service';

/** Agent Catalog filters; a template's first pattern is its badge. */
export const PATTERNS = ['LangGraph basics', 'Single agent', 'Sequential', 'Parallel', 'Conditional', 'Multi-agent', 'Loop', 'Memory',
  'Tools & web', 'Structured output', 'Hierarchical', 'Map-Reduce', 'Human-in-the-loop', 'Conversation', 'Quality checks', 'No-AI steps'] as const;
export type Pattern = typeof PATTERNS[number];

export interface AgentTemplate {
  id: string;
  name: string;
  patterns: Pattern[];
  summary: string;
  /** What it needs beyond the defaults, shown as a badge. */
  needs?: string;
  /** Set when a step kind it needs is not built yet: shown, not usable. */
  comingSoon?: string;
  agent: SaveAgentRequest;
}

const ASK_DATA: AgentTool = { agent: 'ask_data', action: 'deep' };
const ASK_AI: AgentTool = { agent: 'ask_ai', action: 'answer' };
const URL_CONTEXT: AgentTool = { agent: 'url_context', action: 'read' };
const LOAD_MEMORY: AgentTool = { agent: 'load_memory', action: 'search' };
const EXIT_LOOP: AgentTool = { agent: 'exit_loop', action: 'check' };
const APPROVAL: AgentTool = { agent: 'approval', action: 'review' };
const BASICS: Pattern = 'LangGraph basics';
const EVALUATOR: AgentTool = { agent: 'evaluator', action: 'check' };
const GUARDRAIL: AgentTool = { agent: 'guardrail', action: 'check' };
const COMPUTE: AgentTool = { agent: 'compute', action: 'run' };
const MERGE: AgentTool = { agent: 'merge', action: 'join' };

const step = (id: string, text: string, tool: AgentTool, more: Partial<AgentStep> = {}): AgentStep => ({ id, text, tool, ...more });
const input = (name: string, description: string): AgentInput => ({ name, type: 'string', required: true, description });
const output = (name: string, type: 'string' | 'number' | 'boolean' | 'array', description: string): AgentOutput => ({ name, type, description });

/** A router step. Rules: "previous answer contains value", first match wins; AI: the model picks a branch by its label.
 *  A branch labelled Otherwise is the fallback. */
const router = (id: string, text: string, branches: { label: string; value?: string; target: string }[],
                routeBy: 'rules' | 'ai' = 'rules'): AgentStep => ({
  id, text, kind: 'router', routeBy, tool: null,
  branches: branches.map((b, i) => {
    const fallback = b.label === 'Otherwise';
    return { id: `${id}-b${i + 1}`, label: b.label, input: 'last_answer', target: b.target,
      op: fallback ? 'else' : routeBy === 'ai' ? 'equals' : 'contains', value: fallback || routeBy === 'ai' ? null : b.value ?? null };
  }),
});

function agent(a: {
  name: string; role: string; description: string; goal: string; steps: AgentStep[]; type?: AgentType; maxIterations?: number;
  inputs?: AgentInput[]; outputs?: AgentOutput[]; systemPrompt?: string; customTools?: AgentCustomTool[];
}): SaveAgentRequest {
  const tools: AgentTool[] = [];
  for (const s of a.steps) if (s.tool && !tools.some(t => t.agent === s.tool!.agent && t.action === s.tool!.action)) tools.push(s.tool);
  return {
    name: a.name, role: a.role, description: a.description, systemPrompt: a.systemPrompt ?? null, goal: a.goal,
    steps: a.steps, tools, inputs: a.inputs ?? [], outputs: a.outputs ?? [], status: 'draft',
    type: a.type ?? 'sequential', maxIterations: a.maxIterations ?? 5, customTools: a.customTools ?? [],
    askData: tools.some(t => t.agent === 'ask_data') ? { businessRules: null, examples: null, allowedSchemas: [], maxRows: 500 } : null,
  };
}

const CLUSTER = input('cluster', 'Cluster name, for example Nimr');

/** Public weather API (no key) for the weather template. */
const SITE_WEATHER: AgentCustomTool = {
  name: 'site_weather', description: 'Current temperature and wind speed at a latitude / longitude.', method: 'GET',
  url: 'https://api.open-meteo.com/v1/forecast?current=temperature_2m,wind_speed_10m',
  parameters: [
    { name: 'latitude', type: 'float', description: 'Latitude in decimal degrees', required: true },
    { name: 'longitude', type: 'float', description: 'Longitude in decimal degrees', required: true },
  ],
  headers: [], body: null, responsePath: 'current', authScheme: 'none', authSecret: null, timeout: 20,
};

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'well-count', name: 'Well Count Assistant', patterns: ['Single agent'],
    summary: 'One step: counts the wells of a cluster from the database. The smallest useful agent.',
    agent: agent({
      name: 'Well Count Assistant', role: 'Well data assistant', description: 'Answers how many wells a cluster has.',
      goal: 'Give a verified well count for the cluster.', inputs: [CLUSTER],
      steps: [step('count', 'How many wells are there in {{cluster}} cluster?', ASK_DATA)],
    }),
  },
  {
    id: 'well-status-report', name: 'Well Status Report', patterns: ['Sequential'],
    summary: 'Counts → delays → summary. Each step sees the earlier answers; the last one writes the report.',
    agent: agent({
      name: 'Well Status Report', role: 'Drilling data analyst', description: 'Writes a short status report for a cluster.',
      goal: 'A short, factual status report for the cluster.', inputs: [CLUSTER],
      steps: [
        step('counts', 'How many wells in {{cluster}} cluster are in each status?', ASK_DATA),
        step('delays', 'Which wells in {{cluster}} cluster are behind plan, and by how many days?', ASK_DATA),
        step('report', 'Write a five-line status report for {{cluster}} from the results above.', ASK_AI),
      ],
    }),
  },
  {
    id: 'cluster-snapshot', name: 'Cluster Snapshot', patterns: ['Parallel'],
    summary: 'Three questions run at the same time, then one combined answer (fan-out / fan-in).',
    agent: agent({
      name: 'Cluster Snapshot', role: 'Operations analyst', description: 'A quick snapshot of a cluster from three angles.',
      goal: 'One combined snapshot of the cluster.', type: 'parallel', inputs: [CLUSTER],
      steps: [
        step('wells', 'How many wells are there in {{cluster}} cluster?', ASK_DATA),
        step('rigs', 'Which rigs are working in {{cluster}} cluster now?', ASK_DATA),
        step('late', 'How many wells in {{cluster}} cluster are behind plan?', ASK_DATA),
      ],
    }),
  },
  {
    id: 'issue-triage', name: 'Production Issue Triage', patterns: ['Conditional'],
    summary: 'Classifies an issue, then a rule sends it to the equipment, schedule or data specialist step.',
    agent: agent({
      name: 'Production Issue Triage', role: 'Operations triage assistant', description: 'Routes a reported issue to the right check.',
      goal: 'Say what the issue affects and what to check first.', inputs: [input('issue', 'The issue as reported')],
      steps: [
        step('classify', 'Classify this issue with one word — equipment, schedule or data: {{issue}}', ASK_AI, { outputKey: 'category', temperature: 0 }),
        router('route', 'Which specialist?', [
          { label: 'Equipment', value: 'equipment', target: 'equipment' },
          { label: 'Schedule', value: 'schedule', target: 'schedule' },
          { label: 'Otherwise', target: 'data' },
        ]),
        step('equipment', 'Which wells and rigs could this equipment issue affect: {{issue}}?', ASK_DATA, { next: 'answer' }),
        step('schedule', 'Which wells behind plan could this affect: {{issue}}?', ASK_DATA, { next: 'answer' }),
        step('data', 'Which data should be checked first for this issue, and why: {{issue}}', ASK_AI),
      ],
    }),
  },
  {
    id: 'question-router', name: 'Well Question Router', patterns: ['Conditional', 'Multi-agent'],
    summary: 'The AI picks one of four specialists by meaning; "Otherwise" catches anything else.',
    agent: agent({
      name: 'Well Question Router', role: 'Well monitoring assistant', description: 'Sends each question to the right specialist.',
      goal: 'Answer the question with the right specialist.', inputs: [input('question', 'Any question about wells')],
      steps: [
        router('route', 'Which specialist should answer: {{question}}', [
          { label: 'Well counts and status', target: 'status' },
          { label: 'Schedules and delays', target: 'schedule' },
          { label: 'Plan versus actual KPIs', target: 'kpi' },
          { label: 'Otherwise', target: 'general' },
        ], 'ai'),
        step('status', '{{question}}', ASK_DATA, { next: 'answer' }),
        step('schedule', '{{question}} Include planned and actual dates.', ASK_DATA, { next: 'answer' }),
        step('kpi', '{{question}} Compare plan with actual.', ASK_DATA, { next: 'answer' }),
        step('general', 'Answer briefly: {{question}}', ASK_AI),
      ],
    }),
  },
  {
    id: 'ops-supervisor', name: 'Operations Supervisor', patterns: ['Multi-agent'],
    summary: 'A supervisor picks a worker and its task each round — database, web page or analysis — until done.',
    agent: agent({
      name: 'Operations Supervisor', role: 'Operations supervisor', description: 'Coordinates specialists to answer one question.',
      goal: 'Answer the question: {{question}}', type: 'supervisor', maxIterations: 5, inputs: [input('question', 'The question to answer')],
      steps: [
        step('db', 'Database specialist: answers questions about wells, rigs and schedules.', ASK_DATA),
        step('web', 'Web reader: reads a page when the task gives a https:// address.', URL_CONTEXT),
        step('analyst', 'Analyst: explains, compares or summarises the findings so far.', ASK_AI),
      ],
    }),
  },
  {
    id: 'report-refiner', name: 'Report Refiner', patterns: ['Loop'],
    summary: 'Draft ↔ critic until the critic is satisfied (Exit Loop) or 3 rounds pass.',
    agent: agent({
      name: 'Report Refiner', role: 'Report writer', description: 'Improves a report until a critic approves it.',
      goal: 'A clear, correct report on the topic.', type: 'loop', maxIterations: 3, inputs: [input('topic', 'What the report is about')],
      steps: [
        step('draft', 'Write (or, if there is a critique above, improve) a short report on {{topic}}.', ASK_AI),
        step('critic', 'Critique the latest draft: list what is missing, unclear or unsupported. Say "approved" if nothing important.', ASK_AI),
        step('stop', 'Stop when the critic approved the draft.', EXIT_LOOP),
      ],
    }),
  },
  {
    id: 'site-weather', name: 'Well Site Weather Check', patterns: ['Tools & web'],
    summary: 'Looks up a well\'s coordinates, then the model calls a weather API Tool with them.',
    needs: 'Internet access from the agent runtime',
    agent: agent({
      name: 'Well Site Weather Check', role: 'Field operations assistant', description: 'Current weather at a well site.',
      goal: 'Say whether the weather allows field work at the well.', inputs: [input('well', 'Well name')],
      customTools: [SITE_WEATHER],
      steps: [
        step('where', 'What are the latitude and longitude of well {{well}}?', ASK_DATA),
        step('weather', 'What is the current weather at that well\'s location? Is wind above 40 km/h?', { agent: 'api', action: 'site_weather' }),
      ],
    }),
  },
  {
    id: 'daily-ops-summary', name: 'Daily Ops Summary', patterns: ['Structured output', 'Sequential'],
    summary: 'A written summary plus typed fields (numbers, top issue) that other systems can read.',
    agent: agent({
      name: 'Daily Ops Summary', role: 'Operations reporter', description: 'Daily summary with fixed fields.',
      goal: 'Today\'s operations summary for the cluster.', inputs: [CLUSTER],
      outputs: [
        output('wells_active', 'number', 'Wells being drilled or completed'),
        output('wells_behind_plan', 'number', 'Wells behind plan'),
        output('top_issue', 'string', 'The most important issue'),
      ],
      steps: [
        step('facts', 'For {{cluster}} cluster: how many wells are active, and how many are behind plan?', ASK_DATA),
        step('summary', 'Write today\'s summary for {{cluster}} and name the single most important issue.', ASK_AI),
      ],
    }),
  },
  {
    id: 'field-engineer', name: 'Field Engineer Assistant', patterns: ['Memory'],
    summary: 'Remembers facts between runs (Load Memory) and uses them with fresh data.',
    agent: agent({
      name: 'Field Engineer Assistant', role: 'Field engineer assistant', description: 'Answers with what it learned before.',
      goal: 'Answer using earlier findings and current data.', inputs: [input('question', 'The question')],
      steps: [
        step('recall', 'What do we already know that helps with: {{question}}', LOAD_MEMORY),
        step('data', '{{question}}', ASK_DATA),
      ],
    }),
  },
  {
    id: 'bulletin-reader', name: 'Bulletin Reader', patterns: ['Tools & web'],
    summary: 'Reads a public page (bulletin, regulation, notice) and lists what it means for operations.',
    needs: 'Internet access from the agent runtime',
    agent: agent({
      name: 'Bulletin Reader', role: 'Compliance reader', description: 'Turns a public notice into action points.',
      goal: 'Action points for operations from the page.', inputs: [input('url', 'Page address (https://…)')],
      steps: [step('read', 'Read {{url}} and list the points that affect drilling operations, with dates.', URL_CONTEXT)],
    }),
  },
  {
    id: 'fast-router', name: 'Fast Router + Strong Writer', patterns: ['Conditional'],
    summary: 'A small fast model classifies; the default model writes. Set the model per step.',
    agent: agent({
      name: 'Fast Router + Strong Writer', role: 'Assistant', description: 'Cheap routing, careful answers.',
      goal: 'A careful answer at low cost.', inputs: [input('question', 'The question')],
      steps: [
        step('classify', 'Is this about data (reply data) or explanation (reply explain)? {{question}}', ASK_AI,
          { model: 'gpt-4o-mini', temperature: 0, maxTokens: 5 }),
        router('route', 'Data or explanation?', [
          { label: 'Data', value: 'data', target: 'data' },
          { label: 'Otherwise', target: 'write' },
        ]),
        step('data', '{{question}}', ASK_DATA, { next: 'answer' }),
        step('write', 'Explain clearly: {{question}}', ASK_AI),
      ],
    }),
  },
  {
    id: 'support-triage', name: 'Support Triage (end to end)', patterns: ['Conditional', 'Memory', 'Structured output'],
    summary: 'Memory + classification + routing + data + typed reply: the full pattern most support agents start from.',
    agent: agent({
      name: 'Support Triage', role: 'Support assistant', description: 'Triage and reply for operations requests.',
      goal: 'Classify the request, find the facts and draft the reply.', inputs: [input('request', 'The request as received')],
      outputs: [output('category', 'string', 'data, access or other'), output('priority', 'string', 'low, medium or high'),
        output('reply', 'string', 'The reply to send')],
      steps: [
        step('recall', 'What do we know that helps with this request: {{request}}', LOAD_MEMORY),
        step('classify', 'Classify the request as data, access or other (one word): {{request}}', ASK_AI, { outputKey: 'kind', temperature: 0 }),
        router('route', 'Data request?', [{ label: 'Data', value: 'data', target: 'facts' }, { label: 'Otherwise', target: 'reply' }]),
        step('facts', 'Find the data asked for: {{request}}', ASK_DATA),
        step('reply', 'Draft a short, polite reply to: {{request}}', ASK_AI),
      ],
    }),
  },
  {
    id: 'delay-analyst', name: 'Schedule Delay Analyst', patterns: ['Sequential'],
    summary: 'Wells behind plan → most delayed tasks → likely causes → recommendations.',
    agent: agent({
      name: 'Schedule Delay Analyst', role: 'Planning analyst', description: 'Explains schedule delays and what to do.',
      goal: 'Explain the delays in the cluster and recommend actions.', inputs: [CLUSTER],
      steps: [
        step('late', 'Which wells in {{cluster}} cluster are behind plan, and by how many days?', ASK_DATA),
        step('tasks', 'For those wells, which tasks are the most delayed?', ASK_DATA),
        step('causes', 'From the results above, what are the likely causes of the delays?', ASK_AI),
        step('actions', 'Recommend up to five actions, most effective first.', ASK_AI),
      ],
    }),
  },
  {
    id: 'plan-vs-actual', name: 'Plan vs Actual KPI', patterns: ['Parallel', 'Structured output'],
    summary: 'Rig-on, spud and completion counts against plan at the same time, then one variance summary.',
    agent: agent({
      name: 'Plan vs Actual KPI', role: 'KPI analyst', description: 'Variance of the main drilling KPIs.',
      goal: 'Plan versus actual for the cluster with the variance explained.', type: 'parallel', inputs: [CLUSTER],
      outputs: [output('rig_on_variance', 'number', 'Actual minus planned rig-on count'),
        output('spud_variance', 'number', 'Actual minus planned spud count'),
        output('completion_variance', 'number', 'Actual minus planned completions')],
      steps: [
        step('rig_on', 'In {{cluster}} cluster this year: planned versus actual rig-on count?', ASK_DATA),
        step('spud', 'In {{cluster}} cluster this year: planned versus actual spud count?', ASK_DATA),
        step('completion', 'In {{cluster}} cluster this year: planned versus actual completions?', ASK_DATA),
      ],
    }),
  },
  {
    id: 'compare-clusters', name: 'Compare Two Clusters', patterns: ['Parallel'],
    summary: 'The same questions for two clusters at once, then a side-by-side comparison.',
    agent: agent({
      name: 'Compare Two Clusters', role: 'Operations analyst', description: 'Side-by-side comparison of two clusters.',
      goal: 'Compare the two clusters side by side, as a short table.', type: 'parallel',
      inputs: [input('cluster_a', 'First cluster'), input('cluster_b', 'Second cluster')],
      steps: [
        step('a_wells', 'How many wells are in {{cluster_a}} cluster, and how many are behind plan?', ASK_DATA),
        step('b_wells', 'How many wells are in {{cluster_b}} cluster, and how many are behind plan?', ASK_DATA),
        step('a_rigs', 'How many rigs are working in {{cluster_a}} cluster?', ASK_DATA),
        step('b_rigs', 'How many rigs are working in {{cluster_b}} cluster?', ASK_DATA),
      ],
    }),
  },
  {
    id: 'rig-move-planner', name: 'Rig Move Planner', patterns: ['Sequential', 'Conditional'],
    summary: 'Next wells per rig → conflicts → (resolve them if any) → a ranked move list.',
    agent: agent({
      name: 'Rig Move Planner', role: 'Rig scheduler', description: 'Plans the next rig moves.',
      goal: 'A ranked list of rig moves without conflicts.', inputs: [CLUSTER],
      steps: [
        step('next', 'For each rig in {{cluster}} cluster, which wells are planned next, with dates?', ASK_DATA),
        step('conflicts', 'List any conflicts in that plan (two rigs on one well, overlaps, gaps). Reply "none" if there are none.', ASK_AI,
          { outputKey: 'conflicts' }),
        router('route', 'Any conflicts?', [{ label: 'No conflicts', value: 'none', target: 'rank' }, { label: 'Otherwise', target: 'resolve' }]),
        step('resolve', 'Suggest how to resolve these conflicts: {{conflicts}}', ASK_AI, { next: 'rank' }),
        step('rank', 'Give the rig moves as a ranked list: rig, from well, to well, date.', ASK_AI),
      ],
    }),
  },
  {
    id: 'well-master-check', name: 'Well Master Data Check', patterns: ['Parallel', 'Structured output'],
    summary: 'Three data quality checks at once, returned as counts per issue plus a summary.',
    agent: agent({
      name: 'Well Master Data Check', role: 'Data quality analyst', description: 'Finds gaps in the well master data.',
      goal: 'How clean the well master data is, with the worst issues first.', type: 'parallel',
      outputs: [output('missing_dates', 'number', 'Wells missing key dates'), output('missing_links', 'number', 'Wells without a project'),
        output('duplicates', 'number', 'Duplicated well names')],
      steps: [
        step('dates', 'How many wells have no spud date or no rig-on date? Show up to 10.', ASK_DATA),
        step('links', 'How many wells are not linked to a project? Show up to 10.', ASK_DATA),
        step('dupes', 'Which well names appear more than once?', ASK_DATA),
      ],
    }),
  },
  {
    id: 'executive-briefing', name: 'Executive Briefing', patterns: ['Multi-agent'],
    summary: 'A supervisor decides which questions to ask the data, then has a writer produce a one-page brief.',
    agent: agent({
      name: 'Executive Briefing', role: 'Chief of staff', description: 'A one-page brief for management.',
      goal: 'A one-page management brief on: {{topic}}', type: 'supervisor', maxIterations: 6,
      inputs: [input('topic', 'What the brief is about')],
      steps: [
        step('data', 'Data analyst: finds the facts and numbers in the database.', ASK_DATA),
        step('writer', 'Writer: turns the findings into a one-page brief with headline, three points and risks.', ASK_AI),
      ],
    }),
  },
  {
    id: 'hse-triage', name: 'HSE / Issue Triage', patterns: ['Conditional'],
    summary: 'The AI classifies a report as safety, equipment or schedule and sends it to that specialist.',
    agent: agent({
      name: 'HSE / Issue Triage', role: 'HSE coordinator', description: 'Routes reported issues to the right specialist.',
      goal: 'Say who should act, how urgently, and what to check.', inputs: [input('report', 'The reported issue')],
      steps: [
        router('route', 'What kind of issue is this: {{report}}', [
          { label: 'Safety or environment', target: 'safety' },
          { label: 'Equipment', target: 'equipment' },
          { label: 'Otherwise', target: 'schedule' },
        ], 'ai'),
        step('safety', 'Safety issue: {{report}}. List immediate actions and who must be told, most urgent first.', ASK_AI, { next: 'answer' }),
        step('equipment', 'Which wells and rigs are affected by: {{report}}?', ASK_DATA, { next: 'answer' }),
        step('schedule', 'Which planned work could be delayed by: {{report}}?', ASK_DATA),
      ],
    }),
  },
  {
    id: 'weekly-ops-report', name: 'Weekly Ops Report', patterns: ['Sequential'],
    summary: 'This week\'s numbers and changes as a report. Run it from Test Agent now; scheduling comes with Triggers.',
    needs: 'Schedule trigger (coming)',
    agent: agent({
      name: 'Weekly Ops Report', role: 'Operations reporter', description: 'Weekly operations report.',
      goal: 'A weekly report: numbers, changes since last week, risks.', inputs: [CLUSTER],
      steps: [
        step('week', 'For {{cluster}} cluster, what changed in the last 7 days: spuds, rig moves, completions?', ASK_DATA),
        step('late', 'Which wells in {{cluster}} cluster slipped further behind plan this week?', ASK_DATA),
        step('report', 'Write the weekly report: headline, numbers, changes, top three risks.', ASK_AI),
      ],
    }),
  },
  {
    id: 'asset-review-team', name: 'Asset Review Team', patterns: ['Hierarchical'],
    summary: 'A lead agent runs other published agents as sub-agents (a data team, a writing team), then reviews.',
    needs: 'Two published agents: set them as the Tool of steps 1 and 2 (Tools & Capabilities → Sub-agents)',
    agent: agent({
      name: 'Asset Review Team', role: 'Asset review lead', description: 'Coordinates two sub-agent teams.',
      goal: 'A reviewed asset report for the cluster.', inputs: [CLUSTER],
      steps: [
        step('data_team', 'Data team: collect the cluster\'s wells, rigs and delays for {{cluster}}.', ASK_DATA),
        step('writing_team', 'Writing team: turn the findings into an asset report for {{cluster}}.', ASK_AI),
        step('review', 'Lead review: check the report against the findings and list any gaps.', ASK_AI),
      ],
    }),
  },
  {
    id: 'per-well-review', name: 'Per-Well Review', patterns: ['Map-Reduce'],
    summary: 'Lists the late wells, reviews every one of them in parallel (For Each), then ranks them.',
    agent: agent({
      name: 'Per-Well Review', role: 'Well reviewer', description: 'Reviews each late well, then ranks them.',
      goal: 'A ranked review of the late wells, worst first.', inputs: [CLUSTER],
      steps: [
        step('late', 'List the names of the wells in {{cluster}} cluster that are behind plan (at most 10).', ASK_DATA, { outputKey: 'wells' }),
        step('review', 'For well {{item}}: how many days behind plan is it, and which task is the most delayed?', ASK_DATA, { forEach: 'wells' }),
        step('rank', 'Rank the reviewed wells, worst first, with one line each.', ASK_AI),
      ],
    }),
  },
  {
    id: 'approve-before-send', name: 'Approve Before Send', patterns: ['Human-in-the-loop'],
    summary: 'Drafts a message to the field team, pauses for a person to approve, edit or reject it, then finalises it.',
    agent: agent({
      name: 'Approve Before Send', role: 'Communications assistant', description: 'Drafts a field message and waits for approval.',
      goal: 'An approved message for the field team.', inputs: [input('topic', 'What the message is about')],
      steps: [
        step('facts', 'What are the current facts about: {{topic}}?', ASK_DATA),
        step('draft', 'Draft a short, clear message to the field team about {{topic}} from the facts above.', ASK_AI),
        step('approve', 'Approve the message before it is sent.', APPROVAL),
        step('final', 'Return the approved message ready to send, with a subject line.', ASK_AI),
      ],
    }),
  },

  // ── LangGraph basics: the classic patterns, on their usual topics ─────────
  {
    id: 'lg-hello', name: 'Hello Graph', patterns: [BASICS, 'Single agent'],
    summary: 'START → one model step → END. The smallest graph: a question in, an answer out.',
    agent: agent({
      name: 'Hello Graph', role: 'Assistant', description: 'Answers one question.', goal: 'Answer the question in one sentence.',
      inputs: [input('question', 'Any question')], steps: [step('reply', '{{question}}', ASK_AI)],
    }),
  },
  {
    id: 'lg-chain', name: 'Sequential Chain (title → body → conclusion)', patterns: [BASICS, 'Sequential'],
    summary: 'Three steps in a row; each one uses the previous answer through its output key ({{title}}, {{body}}).',
    agent: agent({
      name: 'Blog Writer Chain', role: 'Writer', description: 'Writes a short blog post in three steps.', goal: 'A short blog post on the topic.',
      inputs: [input('topic', 'What the post is about')],
      steps: [
        step('title', 'Write a blog title about {{topic}} in under 30 characters.', ASK_AI, { outputKey: 'title' }),
        step('body', 'Write a blog post titled "{{title}}" in under 100 words.', ASK_AI, { outputKey: 'body' }),
        step('conclusion', 'Write a conclusion of under 20 words for this post: {{body}}', ASK_AI),
      ],
    }),
  },
  {
    id: 'lg-intent', name: 'Conditional Routing (intent)', patterns: [BASICS, 'Conditional'],
    summary: 'Classify the message as question, complaint or compliment, then a rule picks the matching reply step.',
    agent: agent({
      name: 'Intent Router', role: 'Support assistant', description: 'Replies in the right tone for the intent.', goal: 'The right reply for the message.',
      inputs: [input('message', 'The customer message')],
      steps: [
        step('classify', 'Classify the main intent of this message as exactly one word: question, complaint or compliment. '
          + 'Dissatisfaction is a complaint even when asked as a question. Message: {{message}}', ASK_AI, { outputKey: 'intent', temperature: 0 }),
        router('route', 'Which intent?', [
          { label: 'Complaint', value: 'complaint', target: 'complaint' },
          { label: 'Compliment', value: 'compliment', target: 'compliment' },
          { label: 'Otherwise', target: 'question' },
        ]),
        step('complaint', 'Respond empathetically: {{message}}', ASK_AI, { next: 'answer' }),
        step('compliment', 'Respond warmly: {{message}}', ASK_AI, { next: 'answer' }),
        step('question', 'Answer helpfully: {{message}}', ASK_AI),
      ],
    }),
  },
  {
    id: 'lg-cycle', name: 'Cycles: draft → check → retry (max 3)', patterns: [BASICS, 'Loop', 'Conditional'],
    summary: 'A Conditional sends the run back to the draft until the check passes or 3 tries are used (Max iterations).',
    agent: agent({
      name: 'Draft and Check', role: 'Careful writer', description: 'Redrafts until a check passes.', goal: 'A draft that passes the check.',
      maxIterations: 3, inputs: [input('task', 'What to write')],
      steps: [
        step('draft', 'Write (or fix, using the problems found above) a short answer for: {{task}}', ASK_AI),
        step('verify', 'Check the latest draft. Reply OK if it is correct and complete, otherwise list the problems.', ASK_AI, { temperature: 0 }),
        router('route', 'Did it pass?', [{ label: 'Passed', value: 'ok', target: 'answer' }, { label: 'Otherwise', target: 'draft' }]),
      ],
    }),
  },
  {
    id: 'lg-fanout', name: 'Parallel Fan-out / Fan-in', patterns: [BASICS, 'Parallel'],
    summary: 'Title, outline and introduction are written at the same time, then joined into one answer.',
    agent: agent({
      name: 'Parallel Sections', role: 'Writer', description: 'Three sections at once.', goal: 'All three sections for the post.',
      type: 'parallel', inputs: [input('topic', 'What the post is about')],
      steps: [
        step('title', 'For a blog post about {{topic}}, write a catchy title.', ASK_AI),
        step('outline', 'For a blog post about {{topic}}, write a 5-point outline.', ASK_AI),
        step('intro', 'For a blog post about {{topic}}, write an engaging introduction.', ASK_AI),
      ],
    }),
  },
  {
    id: 'lg-thread', name: 'Conversation Memory (thread)', patterns: [BASICS, 'Conversation'],
    summary: 'Each run continues the conversation: tell it your name, then ask "What is my name?".',
    needs: 'Tick "Continue as a conversation" in Test Agent',
    agent: agent({
      name: 'Chat with Memory', role: 'Friendly assistant', description: 'Remembers the conversation.', goal: 'Answer using the conversation so far.',
      inputs: [input('message', 'Your message')], steps: [step('reply', '{{message}}', ASK_AI)],
    }),
  },
  {
    id: 'lg-hitl', name: 'Human-in-the-loop (approve before acting)', patterns: [BASICS, 'Human-in-the-loop'],
    summary: 'Propose an action, pause for a person to approve, edit or reject it, then carry it out.',
    agent: agent({
      name: 'Approve the Action', role: 'Operations assistant', description: 'Asks before it acts.', goal: 'Carry out only an approved action.',
      inputs: [input('request', 'What the user wants done')],
      steps: [
        step('propose', 'A user wants to: {{request}}. Propose one specific action to do it. Be concise.', ASK_AI),
        step('approve', 'Approve the proposed action before it is carried out.', APPROVAL),
        step('execute', 'Carry out the approved action and describe what was done.', ASK_AI),
      ],
    }),
  },
  {
    id: 'lg-subgraphs', name: 'Subgraphs (research team + writing team)', patterns: [BASICS, 'Hierarchical'],
    summary: 'The parent runs two teams as single steps: one researches, one writes. Each team is its own agent.',
    needs: 'Two published agents: set them as the Tool of steps 1 and 2 (Tools & Capabilities → Sub-agents)',
    agent: agent({
      name: 'Research and Write', role: 'Editor', description: 'Coordinates a research team and a writing team.', goal: 'A polished report on the topic.',
      inputs: [input('topic', 'What the report is about')],
      steps: [
        step('research_team', 'Research team: notes and the 5 key facts about {{topic}}.', ASK_AI),
        step('writing_team', 'Writing team: a polished report on {{topic}} from those facts.', ASK_AI),
      ],
    }),
  },
  {
    id: 'lg-workflow', name: 'Complete AI Workflow', patterns: [BASICS, 'Map-Reduce', 'Human-in-the-loop'],
    summary: 'Plan 3 angles → research each (For Each) → combine → draft ↔ review (max 3) → approval → final report.',
    agent: agent({
      name: 'Research Report Workflow', role: 'Research lead', description: 'Plans, researches, drafts, reviews and gets approval.',
      goal: 'An approved, professional report on the topic.', maxIterations: 3, inputs: [input('topic', 'What the report is about')],
      steps: [
        step('plan', 'List exactly 3 distinct research angles for {{topic}} as a JSON array of strings.', ASK_AI, { outputKey: 'angles' }),
        step('research', 'Research this angle of {{topic}}: {{item}}. Give 3–4 key insights.', ASK_AI, { forEach: 'angles' }),
        step('combine', 'Combine the research findings above into one cohesive summary.', ASK_AI),
        step('draft', 'Write (or revise, using the latest review) a professional report on {{topic}} from the summary.', ASK_AI, { outputKey: 'report' }),
        step('review', 'Review the latest report. Reply APPROVED if it is complete and high quality, else REVISE: and the changes needed.', ASK_AI, { temperature: 0 }),
        router('route', 'Approved by the reviewer?', [{ label: 'Approved', value: 'approved', target: 'approve' }, { label: 'Otherwise', target: 'draft' }]),
        step('approve', 'Approve the report before it is finalised: {{report}}', APPROVAL),
      ],
    }),
  },
  {
    id: 'lg-supervisor-team', name: 'Supervisor Team with Human Review', patterns: [BASICS, 'Multi-agent', 'Human-in-the-loop'],
    summary: 'A supervisor routes between researcher, writer, reviewer and a human review, then finishes.',
    agent: agent({
      name: 'Report Team', role: 'Team supervisor', description: 'Researcher, writer, reviewer and human review.',
      goal: 'A reviewed, approved report on: {{task}}', type: 'supervisor', maxIterations: 8, inputs: [input('task', 'What the report is about')],
      steps: [
        step('researcher', 'Researcher: finds the key facts for the task.', ASK_AI),
        step('writer', 'Writer: writes or revises the report from the research and the feedback.', ASK_AI, { outputKey: 'draft' }),
        step('reviewer', 'Reviewer: critiques the latest draft — what is good and what to improve.', ASK_AI),
        step('human_review', 'Human review: a person approves the draft or sends it back: {{draft}}', APPROVAL),
      ],
    }),
  },
  {
    id: 'lg-retry', name: 'Error Handling and Retry', patterns: [BASICS, 'Tools & web'],
    summary: 'A step that calls the outside world is retried up to 3 times (2, 4, 8 s apart) before it fails.',
    needs: 'Internet access from the agent runtime',
    agent: agent({
      name: 'Reliable Page Reader', role: 'Researcher', description: 'Reads a page, retrying on failure.', goal: 'A summary of the page.',
      inputs: [input('url', 'Page address (https://…)')], steps: [step('read', 'Summarise {{url}} in five bullet points.', URL_CONTEXT, { retries: 3 })],
    }),
  },
  {
    id: 'lg-config', name: 'Runtime Configuration (model per step)', patterns: [BASICS, 'Sequential'],
    summary: 'A quick outline on a small model at low temperature, then the article on the default model, more creative.',
    agent: agent({
      name: 'Outline and Article', role: 'Writer', description: 'Different model settings per step.', goal: 'A short article on the topic.',
      inputs: [input('topic', 'What the article is about')],
      steps: [
        step('outline', 'Create a concise 3-point outline about {{topic}}.', ASK_AI, { outputKey: 'outline', model: 'gpt-4o-mini', temperature: 0.2 }),
        step('article', 'Write a short article about {{topic}} using this outline: {{outline}}', ASK_AI, { temperature: 0.8 }),
      ],
    }),
  },
  // ── Well-monitoring versions of the guide's larger patterns ───────────────
  {
    id: 'cluster-review-workflow', name: 'Cluster Review Workflow', patterns: ['Map-Reduce', 'Human-in-the-loop', 'Conditional'],
    summary: 'Pick 3 review areas → check each in the data (For Each) → combine → draft ↔ review (max 3) → approval.',
    agent: agent({
      name: 'Cluster Review Workflow', role: 'Asset review lead', description: 'Reviews a cluster end to end, with approval.',
      goal: 'An approved review of the cluster.', maxIterations: 3, inputs: [CLUSTER],
      steps: [
        step('plan', 'For a review of {{cluster}} cluster, list 3 areas to check (for example delays, rig use, data gaps) as a JSON array of strings.',
          ASK_AI, { outputKey: 'areas' }),
        step('data_check', 'For {{cluster}} cluster: {{item}}. Give the numbers.', ASK_DATA, { forEach: 'areas' }),
        step('combine', 'Combine the findings above into one summary for {{cluster}}.', ASK_AI),
        step('draft', 'Write (or revise, using the latest review) the cluster review for {{cluster}}: headline, findings, risks, actions.', ASK_AI,
          { outputKey: 'review_report' }),
        step('review', 'Review the latest draft against the findings. Reply APPROVED, or REVISE: and what is wrong or missing.', ASK_AI, { temperature: 0 }),
        router('route', 'Approved by the reviewer?', [{ label: 'Approved', value: 'approved', target: 'approve' }, { label: 'Otherwise', target: 'draft' }]),
        step('approve', 'Approve the cluster review before it is shared: {{review_report}}', APPROVAL),
      ],
    }),
  },
  {
    id: 'ops-report-team', name: 'Ops Report Team with Review', patterns: ['Multi-agent', 'Human-in-the-loop'],
    summary: 'A supervisor routes between the data analyst, writer, reviewer and a human review until the report is approved.',
    agent: agent({
      name: 'Ops Report Team', role: 'Operations lead', description: 'Analyst, writer, reviewer and human review.',
      goal: 'An approved operations report on: {{topic}}', type: 'supervisor', maxIterations: 8, inputs: [input('topic', 'What the report is about')],
      steps: [
        step('analyst', 'Data analyst: finds the facts and numbers in the database.', ASK_DATA),
        step('writer', 'Writer: writes or revises the report from the facts and the feedback.', ASK_AI, { outputKey: 'draft' }),
        step('reviewer', 'Reviewer: checks the draft against the facts and lists what to fix.', ASK_AI),
        step('human_review', 'Human review: a person approves the report or sends it back: {{draft}}', APPROVAL),
      ],
    }),
  },
  {
    id: 'field-chat', name: 'Field Assistant Chat', patterns: ['Conversation', 'Single agent'],
    summary: 'Ask follow-up questions about wells: each run sees the conversation so far ("and how many are late?").',
    needs: 'Tick "Continue as a conversation" in Test Agent',
    agent: agent({
      name: 'Field Assistant Chat', role: 'Field assistant', description: 'Answers well questions in a conversation.',
      goal: 'Answer the question, using the conversation for context.', inputs: [input('message', 'Your question')],
      steps: [step('reply', '{{message}}', ASK_DATA)],
    }),
  },
  // ── Quality checks and steps without AI ───────────────────────────────────
  {
    id: 'checked-answer', name: 'Checked Answer (Evaluator)', patterns: ['Quality checks', 'Loop'],
    summary: 'Draft → an Evaluator checks it against criteria → back with the reason until it passes (max 3).',
    agent: agent({
      name: 'Checked Well Summary', role: 'Careful analyst', description: 'A summary that must meet clear criteria.',
      goal: 'A summary that meets the criteria.', maxIterations: 3, inputs: [CLUSTER],
      steps: [
        step('facts', 'For {{cluster}} cluster: how many wells, how many behind plan, and the most delayed well?', ASK_DATA, { retries: 2 }),
        step('draft', 'Write (or fix, using the Evaluator\'s reason above) a three-line summary for {{cluster}}.', ASK_AI, { outputKey: 'summary' }),
        step('verify', 'Gives the well count, the number behind plan and names the most delayed well: {{summary}}', EVALUATOR),
      ],
    }),
  },
  {
    id: 'safe-reply', name: 'Safe Reply (Guardrail)', patterns: ['Quality checks', 'Sequential'],
    summary: 'A guardrail on the question (blocked topics), the answer, then a guardrail that stops replies with personal data.',
    agent: agent({
      name: 'Safe Reply', role: 'Support assistant', description: 'Answers only within the policy.', goal: 'A safe, useful reply.',
      inputs: [input('question', 'The question')],
      steps: [
        step('in_guard', 'Check the question', GUARDRAIL,
          { options: { check: 'inputs', pii: false, blocked: 'salary, password', policy: 'Only questions about wells, rigs and operations; no salaries or personal data.' } }),
        step('reply', '{{question}}', ASK_DATA, { retries: 2 }),
        step('out_guard', 'Check the reply for personal data', GUARDRAIL, { options: { pii: true } }),
      ],
    }),
  },
  {
    id: 'wells-per-rig', name: 'Wells per Rig (Compute)', patterns: ['No-AI steps', 'Parallel'],
    summary: 'Two data questions, then exact arithmetic and a fixed-format line with no AI call.',
    agent: agent({
      name: 'Wells per Rig', role: 'KPI assistant', description: 'Exact ratio from two counts.', goal: 'Wells per rig for the cluster.',
      inputs: [CLUSTER],
      steps: [
        step('wells', 'How many wells are there in {{cluster}} cluster? Reply with the number.', ASK_DATA, { outputKey: 'wells', retries: 2 }),
        step('rigs', 'How many rigs are working in {{cluster}} cluster? Reply with the number.', ASK_DATA, { outputKey: 'rigs', retries: 2 }),
        step('ratio', '{{wells}} / {{rigs}}', COMPUTE, { outputKey: 'ratio', options: { mode: 'math' } }),
        step('line', '{{cluster}}: {{ratio}} wells per rig', COMPUTE),
      ],
    }),
  },
  {
    id: 'merged-snapshot', name: 'Cluster Snapshot (Merge, no AI)', patterns: ['No-AI steps', 'Sequential'],
    summary: 'Three questions, then Merge joins the answers under headings — no extra model call to combine them.',
    agent: agent({
      name: 'Merged Cluster Snapshot', role: 'Operations analyst', description: 'Three answers, joined without AI.',
      goal: 'A snapshot of the cluster.', inputs: [CLUSTER],
      steps: [
        step('wells', 'How many wells are there in {{cluster}} cluster?', ASK_DATA, { outputKey: 'wells', retries: 2 }),
        step('rigs', 'Which rigs are working in {{cluster}} cluster now?', ASK_DATA, { outputKey: 'rigs', retries: 2 }),
        step('late', 'How many wells in {{cluster}} cluster are behind plan?', ASK_DATA, { outputKey: 'late', retries: 2 }),
        step('merge', 'Snapshot of {{cluster}}', MERGE, { options: { keys: 'wells, rigs, late' } }),
      ],
    }),
  },
];

/** A copy to load into the editor, so edits never change the catalog. */
export function templateAgent(id: string): SaveAgentRequest | null {
  const t = AGENT_TEMPLATES.find(x => x.id === id && !x.comingSoon);
  return t ? structuredClone(t.agent) : null;
}
