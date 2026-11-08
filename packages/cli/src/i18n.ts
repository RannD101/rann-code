export type Locale = "id" | "en";

let current: Locale = "id";

export function setLocale(locale: Locale): void {
  current = locale;
}

export function locale(): Locale {
  return current;
}

export function tr(id: string, en: string): string {
  return current === "en" ? en : id;
}

export const EN_COMMANDS: Record<string, string> = {
  help: "Show command help and the command list",
  exit: "Leave the interactive session",
  clear: "Clear the transcript without deleting state",
  compact: "Compact the conversation context",
  status: "Session, model, and queue status",
  improve: "Review a self-improvement proposal",
  doctor: "Diagnose installation and safe repairs",
  version: "CLI, daemon, and protocol versions",
  feedback: "Send feedback or a bug report",
  update: "Check and install updates",
  whatsnew: "Show changes in this version",
  model: "Select or pin a model",
  models: "List models and capabilities",
  permission: "Show or change the permission mode",
  provider: "Manage providers and credentials",
  providers: "Status of all providers",
  cost: "Session, task, or daily cost",
  usage: "Token and cost statistics",
  budget: "Set a cost limit",
  route: "Explain a router decision",
  login: "Store provider credentials",
  logout: "Remove provider credentials",
  agent: "Manage one agent instance",
  tasks: "List tasks and their status",
  task: "View, control, or reprioritize a task",
  plan: "Create, view, or approve a plan",
  execute: "Build a plan and execute it",
  cancel: "Cancel a task or turn",
  pause: "Pause a running task",
  "resume-task": "Resume a paused task",
  retry: "Retry a task or step",
  trace: "Trace task decisions and steps",
  approve: "Approve a permission request",
  deny: "Deny a permission request",
  goal: "Set, check, or close the session goal",
  memory: "Manage memory entries",
  forget: "Delete a memory",
  profile: "View or change the user profile",
  skills: "List installed skills",
  skill: "View one skill",
  "install-skill": "Install a skill from a registry or path",
  "update-skill": "Update a skill",
  tools: "List tools and their status",
  tool: "Run or inspect one tool",
  mcp: "Manage MCP servers",
  plugins: "Manage plugins",
  hooks: "Manage event hooks",
  init: "Initialize a project for Rann",
  project: "Manage registered projects",
  context: "View the context sent to the model",
  files: "List relevant files",
  review: "Review code changes",
  test: "Run project tests",
  git: "Safe Git operations",
  diff: "Show the workspace diff",
  commit: "Create a commit",
  branch: "Manage branches",
  worktree: "Manage worktrees",
  checkpoint: "Create or inspect a checkpoint",
  checkpoints: "List file checkpoints",
  undo: "Restore a checkpoint",
  index: "Rebuild the knowledge index",
  sessions: "List sessions",
  resume: "Resume a session",
  fork: "Duplicate a session",
  history: "Message history",
  rewind: "Rewind to an earlier message",
  new: "Start a new session",
  export: "Export a session or data",
  import: "Import a session or data",
  attach: "Attach a file to the context",
  config: "View or change config",
  permissions: "Manage permission modes and policy",
  settings: "General settings",
  theme: "Choose the terminal theme",
  secrets: "Manage secrets",
  env: "View the tool environment",
  sandbox: "Sandbox status and limits",
  pair: "Create a gateway device pairing code",
  gateway: "Manage the web gateway and devices",
  messaging: "Manage messaging adapters",
  agents: "Manage subagents",
  background: "Manage background tasks",
  queue: "Manage the job queue",
  integrations: "Manage external integrations",
  logs: "View logs",
  health: "Component health check",
  metrics: "View metrics",
  dashboard: "Open the web dashboard",
  whoami: "Current identity and scope",
  notify: "Configure notifications"
};

export function commandDescription(name: string, fallback: string): string {
  return current === "en" ? EN_COMMANDS[name] ?? fallback : fallback;
}
