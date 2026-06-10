export interface AgentProcess {
  pid: number;
  cpu: number;
  mem: number;
  command: string;
  taskId: string | null;
}

export async function listAgentProcesses(): Promise<AgentProcess[]> {
  try {
    const result = await Bun.$`ps -eo pid,pcpu,pmem,command | grep -E 'TASK-[A-Z0-9-]+' | grep -v grep`.text();
    const lines = result.trim().split("\n").filter(Boolean);
    return lines.map((line) => {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[0]!, 10);
      const cpu = parseFloat(parts[1]!);
      const mem = parseFloat(parts[2]!);
      const command = parts.slice(3).join(" ");
      const taskMatch = command.match(/TASK-[A-Z0-9-]+/);
      const taskId = taskMatch ? taskMatch[0] : null;
      return { pid, cpu, mem, command, taskId };
    }).filter((p) => Number.isFinite(p.pid));
  } catch {
    return [];
  }
}
