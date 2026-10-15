/** The "Command" panel on the Overview: what an operator can do from here, and whether each action is switched on for them. */
export type CommandState = "live" | "admin" | "setup" | "next";

export type CommandItem = { id: string; title: string; detail: string; state: CommandState };

const LABEL: Record<CommandState, string> = { live: "LIVE", admin: "ADMIN", setup: "SETUP", next: "NEXT" };
export const stateLabel = (s: CommandState) => LABEL[s];

/**
 * `admin`: the viewer can see the action but only admins can use it.
 * `setup`: an admin could use it, but its environment variable is not set.
 */
export function commandItems(o: { isAdmin: boolean; collectConfigured: boolean; agentConfigured: boolean; registryWritable: boolean }): CommandItem[] {
  const gate = (configured: boolean): CommandState => (!o.isAdmin ? "admin" : configured ? "live" : "setup");
  return [
    { id: "registry", title: "Edit the registry", detail: "Add projects, set pins, assign owners. Retire, never delete.", state: gate(o.registryWritable) },
    { id: "collect", title: "Collect now", detail: "Refresh cell health on demand instead of waiting for the daily run.", state: gate(o.collectConfigured) },
    { id: "agent", title: "Fix with agent", detail: "Turn a drifting pin into a ticket an agent picks up.", state: gate(o.agentConfigured) },
    { id: "next", title: "Deploy cells, rotate keys, publish packages", detail: "Planned. Not available from the Command Center yet.", state: "next" },
  ];
}
