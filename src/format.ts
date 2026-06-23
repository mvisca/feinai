import type { Task } from "./tasks";
import type { Spec, Plan } from "./specs";

export type OutputFormat = "json" | "plain" | "color";

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

function c(format: OutputFormat, color: keyof typeof COLORS, text: string): string {
  return format === "color" ? `${COLORS[color]}${text}${COLORS.reset}` : text;
}

const STATUS_COLOR: Record<string, keyof typeof COLORS> = {
  pending: "yellow",
  in_progress: "blue",
  completed: "green",
  failed: "red",
  deleted: "gray",
  archived: "gray",
};

export function formatTask(task: Task, format: OutputFormat): string {
  if (format === "json") return JSON.stringify(task, null, 2);

  const color = STATUS_COLOR[task.status] ?? "reset";
  const lines: string[] = [];
  lines.push(`${c(format, "bold", task.id)} ${c(format, color, `[${task.status}]`)}`);
  lines.push(`  ${task.subject}`);
  if (task.spec_id) lines.push(`  ${c(format, "dim", "spec:")} ${task.spec_id}`);
  if (task.owner) lines.push(`  ${c(format, "dim", "owner:")} ${task.owner}`);
  if (task.worktree) lines.push(`  ${c(format, "dim", "worktree:")} ${task.worktree}`);
  if (task.blocked_by.length)
    lines.push(`  ${c(format, "dim", "blocked by:")} ${task.blocked_by.join(", ")}`);
  if (task.packages.length)
    lines.push(`  ${c(format, "dim", "packages:")} ${task.packages.join(", ")}`);
  if (task.quality_gates.length) {
    lines.push(`  ${c(format, "dim", "quality gates:")}`);
    for (const gate of task.quality_gates) lines.push(`    - ${gate}`);
  }
  if (task.description) {
    lines.push(`  ${c(format, "dim", "description:")}`);
    for (const line of task.description.split("\n")) lines.push(`    ${line}`);
  }
  if (task.result) lines.push(`  ${c(format, "green", "result:")} ${task.result}`);
  if (task.error) lines.push(`  ${c(format, "red", "error:")} ${task.error}`);
  return lines.join("\n");
}

export function formatTaskList(tasks: Task[], format: OutputFormat): string {
  if (format === "json") return JSON.stringify(tasks, null, 2);
  if (tasks.length === 0) return c(format, "dim", "(no tasks)");

  return tasks
    .map((t) => {
      const color = STATUS_COLOR[t.status] ?? "reset";
      const spec = t.spec_id ? c(format, "dim", `[${t.spec_id}]`) : "";
      const owner = t.owner ? c(format, "dim", ` @${t.owner}`) : "";
      return `${c(format, "bold", t.id)} ${c(format, color, `[${t.status}]`)} ${spec}${owner}  ${t.subject}`;
    })
    .join("\n");
}

export function formatSpec(
  spec: Spec,
  format: OutputFormat,
  opts: { includeContent?: boolean; plan?: Plan } = {},
): string {
  if (format === "json") {
    const obj = opts.plan ? { ...spec, plan: opts.plan } : spec;
    return JSON.stringify(obj, null, 2);
  }

  const color = STATUS_COLOR[spec.status] ?? "reset";
  const lines: string[] = [];
  lines.push(`${c(format, "bold", spec.id)} ${c(format, color, `[${spec.status}]`)}`);
  lines.push(`  ${spec.title}`);
  if (spec.pr) lines.push(`  ${c(format, "dim", "pr:")} ${spec.pr}`);
  if (spec.merged_date)
    lines.push(`  ${c(format, "dim", "merged:")} ${spec.merged_date}`);
  if (spec.content) {
    const bytes = spec.content.length;
    lines.push(`  ${c(format, "dim", `content (${bytes} bytes):`)}`);
    if (opts.includeContent) {
      for (const line of spec.content.split("\n")) lines.push(`    ${line}`);
    } else {
      lines.push(`    ${c(format, "dim", "(use --full to view; feinai spec content " + spec.id + " to export)")}`);
    }
  }
  if (opts.plan) {
    lines.push(`  ${c(format, "dim", `plan (v${opts.plan.version}, ${opts.plan.content.length} bytes):`)}`);
    if (opts.includeContent) {
      for (const line of opts.plan.content.split("\n")) lines.push(`    ${line}`);
    } else {
      lines.push(`    ${c(format, "dim", "(use --full to view; feinai plan show " + spec.id + " to export)")}`);
    }
  }
  return lines.join("\n");
}

export function formatSpecList(specs: Spec[], format: OutputFormat): string {
  if (format === "json") return JSON.stringify(specs, null, 2);
  if (specs.length === 0) return c(format, "dim", "(no specs)");

  return specs
    .map((s) => {
      const color = STATUS_COLOR[s.status] ?? "reset";
      return `${c(format, "bold", s.id)} ${c(format, color, `[${s.status}]`)}  ${s.title}`;
    })
    .join("\n");
}

export function formatPlan(plan: Plan, format: OutputFormat, opts: { includeContent?: boolean } = {}): string {
  if (format === "json") return JSON.stringify(plan, null, 2);
  const lines: string[] = [];
  lines.push(
    `${c(format, "bold", `Plan #${plan.id}`)} ${c(format, "dim", `v${plan.version}`)}  spec: ${plan.spec_id}`,
  );
  lines.push(`  ${c(format, "dim", `created:`)} ${plan.created_at}`);
  lines.push(`  ${c(format, "dim", `content (${plan.content.length} bytes):`)}`);
  if (opts.includeContent) {
    for (const line of plan.content.split("\n")) lines.push(`    ${line}`);
  }
  return lines.join("\n");
}

export function formatPlanList(plans: Plan[], format: OutputFormat): string {
  if (format === "json") return JSON.stringify(plans, null, 2);
  if (plans.length === 0) return c(format, "dim", "(no plans)");
  return plans
    .map(
      (p) =>
        `${c(format, "bold", `v${p.version}`)} ${c(format, "dim", `#${p.id}`)}  ${p.created_at}  ${p.content.length}B`,
    )
    .join("\n");
}

export function formatStatus(
  stats: { pending: number; in_progress: number; completed: number; specs: number; plans: number; serverRunning?: boolean; serverPort?: number; serverUrl?: string },
  format: OutputFormat,
): string {
  if (format === "json") return JSON.stringify(stats, null, 2);
  const serverLine = stats.serverRunning
    ? c(format, "green", `server:      running → ${stats.serverUrl ?? `http://127.0.0.1:${stats.serverPort}`}`)
    : c(format, "dim",   `server:      stopped  (feinai server -d to start)`);
  return [
    `${c(format, "yellow", `pending:     ${stats.pending}`)}`,
    `${c(format, "blue",   `in_progress: ${stats.in_progress}`)}`,
    `${c(format, "green",  `completed:   ${stats.completed}`)}`,
    `${c(format, "dim",    `specs:       ${stats.specs}`)}`,
    `${c(format, "dim",    `plans:       ${stats.plans}`)}`,
    serverLine,
  ].join("\n");
}
