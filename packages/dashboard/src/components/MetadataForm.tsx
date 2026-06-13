import { ChipsInput, type ChipsInputOption } from "./ChipsInput";

/**
 * One entry in the per-kind `availableX` lists that PatchDialog hands
 * to the form. Carries both the FQN (what the user recognises) and
 * the origin URI (what the wire shape needs).
 */
export interface MetadataFormDepOption {
  readonly fqn: string;
  readonly origin: string;
}

export interface MetadataFormValues {
  description: string;
  version: string;
  /** undefined = field absent (skill only) */
  prereqs: string;
  /**
   * Dep refs surface to the form as **origin URI strings**, matching
   * the wire shape expected by `SkillMetadataPatch.dependencies.skills`
   * / `AgentMetadataPatch.dependencies.skills`. The form does the
   * FQN ↔ origin display lookup via the per-kind `availableX` props
   * so the user still sees FQN labels in the chips and dropdown.
   */
  skills: string[];
  mcps: string[];
  /**
   * Agent → agent dep origin URIs. Always empty for skills (skills
   * cannot declare agent deps); kept as a required field so callers
   * don't need to discriminate on `kind`.
   */
  agents: string[];
}

interface MetadataFormProps {
  kind: "skill" | "agent";
  values: MetadataFormValues;
  onChange: (next: MetadataFormValues) => void;
  /**
   * Installed entries available for the skill-deps autocomplete. Each
   * entry's `fqn` is the dropdown label; `origin` is the value stored
   * in `values.skills` when the user picks it.
   */
  availableSkills: readonly MetadataFormDepOption[];
  availableMcps: readonly MetadataFormDepOption[];
  /**
   * Installed agents for the agent-deps chip group. Only meaningful
   * for `kind === "agent"`; omit for skills (skill forms never render
   * the agent-deps group).
   */
  availableAgents?: readonly MetadataFormDepOption[];
  /**
   * Origin URIs in `values.X` that don't resolve to any installed
   * entry — chips matching one of these get the red "missing" treatment.
   */
  missingSkills?: readonly string[];
  missingMcps?: readonly string[];
  /** See {@link availableAgents}. */
  missingAgents?: readonly string[];
  disabled?: boolean;
}

const toChipOptions = (list: readonly MetadataFormDepOption[]): readonly ChipsInputOption[] =>
  list.map((e) => ({ value: e.origin, label: e.fqn }));

export function MetadataForm({
  kind,
  values,
  onChange,
  availableSkills,
  availableMcps,
  availableAgents,
  missingSkills,
  missingMcps,
  missingAgents,
  disabled,
}: MetadataFormProps) {
  const update = <K extends keyof MetadataFormValues>(key: K, val: MetadataFormValues[K]) =>
    onChange({ ...values, [key]: val });

  const skillOptions = toChipOptions(availableSkills);
  const mcpOptions = toChipOptions(availableMcps);
  const agentOptions = toChipOptions(availableAgents ?? []);

  return (
    <div className="metadata-form">
      <div className="form-field">
        <label htmlFor="md-description">Description</label>
        <textarea
          id="md-description"
          rows={2}
          value={values.description}
          onChange={(e) => update("description", e.target.value)}
          disabled={disabled}
          placeholder="A short description of what this does."
        />
      </div>

      <div className="form-field">
        <label htmlFor="md-version">Version</label>
        <input
          id="md-version"
          type="text"
          value={values.version}
          onChange={(e) => update("version", e.target.value)}
          disabled={disabled}
          placeholder="0.0.1"
        />
      </div>

      <div className="form-field">
        <label htmlFor="md-skills">Skill dependencies</label>
        <ChipsInput
          inputId="md-skills"
          values={values.skills}
          onChange={(next) => update("skills", next)}
          options={skillOptions}
          placeholder="Add an installed skill…"
          disabled={disabled}
          emptyText="No skill dependencies"
          invalidValues={missingSkills}
        />
        <p className="form-hint">
          Pick from installed skills, or remove with × on each chip. To add a dependency not in your
          catalog, switch to source mode and write the origin URI directly.
        </p>
      </div>

      <div className="form-field">
        <label htmlFor="md-mcps">MCP dependencies</label>
        <ChipsInput
          inputId="md-mcps"
          values={values.mcps}
          onChange={(next) => update("mcps", next)}
          options={mcpOptions}
          placeholder="Add an installed MCP…"
          disabled={disabled}
          emptyText="No MCP dependencies"
          invalidValues={missingMcps}
        />
      </div>

      {kind === "agent" && (
        <div className="form-field">
          <label htmlFor="md-agents">Agent dependencies</label>
          <ChipsInput
            inputId="md-agents"
            values={values.agents}
            onChange={(next) => update("agents", next)}
            options={agentOptions}
            placeholder="Add an installed agent…"
            disabled={disabled}
            emptyText="No agent dependencies"
            invalidValues={missingAgents}
          />
          <p className="form-hint">
            Pick from installed agents, or remove with × on each chip. To add a dependency not in
            your catalog, switch to source mode and write the origin URI directly.
          </p>
        </div>
      )}

      {kind === "skill" && (
        <div className="form-field">
          <label htmlFor="md-prereqs">Prerequisites</label>
          <textarea
            id="md-prereqs"
            rows={3}
            value={values.prereqs}
            onChange={(e) => update("prereqs", e.target.value)}
            disabled={disabled}
            placeholder="Setup steps the LLM should verify before using this skill."
          />
          <p className="form-hint">
            Free-form text. Leave empty to remove the prereqs field entirely.
          </p>
        </div>
      )}
    </div>
  );
}
