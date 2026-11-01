/**
 * The hub topology decided on 2026-10-30 (tin-boss-api docs/strategy/2026-10-30-hub-topology-and-languages.md, TD-10,
 * as amended by the source audit) and written into the component register on 2026-10-31. Keyed by repository, which is how
 * the collector names a hub in package_snapshots.repo.
 *
 * This is a decision record, not telemetry: it changes when the owner changes the plan, so it lives in code and is reviewed
 * like code. A project's `annotations` (db/005) can carry the same keys (`tin.info/layer`, `tin.info/risk-class`,
 * `tin.info/topology`) and win over this file when present, so the registry can take it over without a code change.
 */
export const TOPOLOGY_STATUSES = ["existing", "planned", "rename", "archive", "shrink"] as const;
export type TopologyStatus = (typeof TOPOLOGY_STATUSES)[number];

export type HubTopology = {
  /** Repository name without the owner, e.g. "shared-identity-hub". */
  repo: string;
  nickname: string | null;
  /** L0 kernel … L5 shell, as the topology plan numbers them. */
  layer: "L0" | "L1" | "L2" | "L3" | "L4" | "L5";
  /** RC-0 (crypto) … RC-5 (composition); lower is stricter. */
  riskClass: "RC-0" | "RC-1" | "RC-2" | "RC-3" | "RC-4" | "RC-5";
  status: TopologyStatus;
  /** One line on what the plan does with this hub. Plain text; rendered as text. */
  note: string;
  /** The harness task(s) that carry the change, if any. */
  tasks: string[];
};

export const TOPOLOGY_DECIDED_ON = "2026-10-30";

export const HUB_TOPOLOGY: readonly HubTopology[] = [
  { repo: "chassis", nickname: "Apollo", layer: "L0", riskClass: "RC-5", status: "existing", note: "Keeps its name and packages. No move.", tasks: [] },
  { repo: "shared-kernel-hub", nickname: null, layer: "L0", riskClass: "RC-5", status: "planned", note: "New: core-kernel 4 cut down to events and tenancy types, plus schema-events and schema-telemetry.", tasks: ["W2-12"] },
  { repo: "shared-trust-hub", nickname: null, layer: "L1", riskClass: "RC-0", status: "rename", note: "Rename of the empty shared-signing-hub. credential-crypto moves in; crypto-webhook, crypto-release and crypto-claims are new.", tasks: ["W0-07", "W2-13"] },
  { repo: "shared-identity-hub", nickname: "Themis", layer: "L2", riskClass: "RC-1", status: "existing", note: "Sole owner of tenants (TD-14). Gains domain-control-plane and the identity-typed helpers from core-kernel.", tasks: ["W2-06"] },
  { repo: "shared-api-hub", nickname: "Hecate", layer: "L2", riskClass: "RC-1", status: "existing", note: "Keeps api-credentials and api-mcp. The BOSS client stays in tin-boss-api (TD-6).", tasks: [] },
  { repo: "shared-integration-hub", nickname: "Hephaestus", layer: "L2", riskClass: "RC-1", status: "existing", note: "Keeps shared ports and the sync engine with no vendor SDK. Finance adapters move to shell-base-finance.", tasks: [] },
  { repo: "shared-ai-hub", nickname: null, layer: "L3", riskClass: "RC-3", status: "planned", note: "New: model gateway, governance and every metered model-vendor adapter (TD-3). Replaces the planned shared-llm-hub.", tasks: ["W2-12"] },
  { repo: "shared-notifications-hub", nickname: null, layer: "L3", riskClass: "RC-4", status: "planned", note: "New: domain-email moves in; vendor adapters split out of it.", tasks: ["W2-12"] },
  { repo: "shared-asset-hub", nickname: null, layer: "L3", riskClass: "RC-4", status: "existing", note: "Absorbs the planned storage hub. Moves to the release kit (W2-03).", tasks: ["W2-03"] },
  { repo: "shared-client-care-hub", nickname: "Hestia", layer: "L4", riskClass: "RC-4", status: "existing", note: "Gains domain-followup (the boss mail follow-up) and the comms CRM-sync tables.", tasks: ["W2-12", "W3-10"] },
  { repo: "shell-base-cxp", nickname: "Hermes", layer: "L4", riskClass: "RC-4", status: "rename", note: "Renamed to shell-base-conversations; comms is split five ways (audit A5).", tasks: ["W2-12"] },
  { repo: "shell-base-conversations", nickname: null, layer: "L4", riskClass: "RC-4", status: "planned", note: "The renamed shell-base-cxp: schema-conversations, domain-conversations, domain-translation, ui-conversations.", tasks: ["W2-12"] },
  { repo: "shared-voice-hub", nickname: null, layer: "L4", riskClass: "RC-4", status: "planned", note: "New: telephony, voice agents and the media relay, out of Konnect app code.", tasks: ["W2-12"] },
  { repo: "shell-base-agents", nickname: "Athena", layer: "L4", riskClass: "RC-4", status: "existing", note: "Loses its governance modules to shared-ai-hub; gains the chat responder that replaces domain-chatbot.", tasks: [] },
  { repo: "shell-base-meetings", nickname: "Clio", layer: "L4", riskClass: "RC-4", status: "existing", note: "Sole owner of meeting_*; gains adapter-recall and the comms calendar integration.", tasks: ["W2-07"] },
  { repo: "shell-base-knowledge", nickname: "Mnemosyne", layer: "L4", riskClass: "RC-4", status: "existing", note: "knowledge is split into schema-, domain-, ui- and -worker packages; release signing moves to crypto-release.", tasks: [] },
  { repo: "shell-base-finance", nickname: "Plutus", layer: "L4", riskClass: "RC-2", status: "existing", note: "Gains four adapters from shared-integration-hub after a live registry check (TD-16).", tasks: [] },
  { repo: "shell-base-boss", nickname: "Peitho", layer: "L4", riskClass: "RC-4", status: "archive", note: "Archived after boss becomes domain-followup in shared-client-care-hub (TD-10).", tasks: [] },
  { repo: "shell-base-admin", nickname: "Atlas", layer: "L5", riskClass: "RC-5", status: "shrink", note: "Shrinks to platform and ui-shell. core-kernel, domain-control-plane and domain-email move out.", tasks: ["W2-12"] },
];

export const topologyByRepo = (): Map<string, HubTopology> => new Map(HUB_TOPOLOGY.map((h) => [h.repo, h]));
