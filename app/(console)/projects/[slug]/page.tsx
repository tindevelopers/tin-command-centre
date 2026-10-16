import Link from "next/link";
import { notFound } from "next/navigation";
import { currentOperator, requireOperator } from "@/src/auth/access";
import { bySeverity, computeDrift } from "@/src/registry/drift";
import { loadGroups, loadObserved, loadRegistry, registryConfigured, registryWritable } from "@/src/registry/db";
import { ASSIGN_ROLES, ENV_NAMES, KINDS, LIFECYCLES, RELATIONS, TIERS } from "@/src/registry/types";
import { addRelation, assign, removePin, removeRelation, saveEnvironment, saveProject, setPin, unassign } from "../actions";
import { compareReported, needsReports } from "@/src/boss/compare";
import { readReports } from "@/src/boss/reports";
import { ReportedPins } from "@/components/ReportedPins";
import { ErrorNotice, Findings, Section, Select, btnCls, inputCls, linkBtnCls } from "@/components/RegistryUi";
import { Notice, PageHeading, Table, fmt, td } from "@/components/StatusUi";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  await requireOperator();
  const { slug } = await params;
  const { error } = await searchParams;
  if (!registryConfigured()) return <Notice>The status store is not connected. Set CONSOLE_DATABASE_URL.</Notice>;

  const [reg, observed, op, groups] = await Promise.all([loadRegistry(), loadObserved(), currentOperator(), loadGroups()]);
  const project = reg.projects.find((p) => p.slug === slug);
  if (!project) notFound();

  const canEdit = op?.role === "admin" && registryWritable();
  const envs = reg.environments.filter((e) => e.projectSlug === slug);
  const pins = reg.pins.filter((p) => p.projectSlug === slug);
  const assignments = reg.assignments.filter((a) => a.projectSlug === slug);
  const out = reg.relations.filter((r) => r.fromSlug === slug);
  const into = reg.relations.filter((r) => r.toSlug === slug);
  const findings = computeDrift(reg, observed.packages, observed.cells).filter((f) => f.projectSlug === slug).sort(bySeverity);
  const hidden = <input type="hidden" name="slug" value={slug} />;
  // What the platform reports it runs (BOSS GET /v1/reports), only asked for when this project has something to compare. Never throws.
  const reports = needsReports(project, pins) ? await readReports() : null;
  const comparisons = reports ? compareReported({ projects: reg.projects, pins }, reports) : [];

  return (
    <div>
      <PageHeading title={project.name} subtitle={`${project.kind} · ${project.slug}${project.repo ? ` · ${project.repo}${project.path ? `/${project.path}` : ""}` : ""}`} />
      {project.ownerProject && (
        <p className="-mt-2 mb-4 text-sm text-gray-600 dark:text-gray-300">
          Owned by {project.ownerProject === slug ? "itself (top-level owner)" : <Link href={`/projects/${project.ownerProject}`} className="underline">{reg.projects.find((x) => x.slug === project.ownerProject)?.name ?? project.ownerProject}</Link>}
        </p>
      )}
      <ErrorNotice message={error} />
      {project.lifecycle === "retired" && <Notice>This project is retired. It is excluded from drift checks.</Notice>}

      <Section title="Drift">
        {findings.length === 0 ? <Notice>{project.lifecycle === "retired" ? "Retired projects are not checked." : "Nothing declared for this project yet, so there is nothing to compare."}</Notice> : <Findings findings={findings} />}
      </Section>

      <Section title="Environments">
        {envs.length === 0 ? <Notice>No environments declared.</Notice> : (
          <Table head={["Environment", "Cell", "Region", "URL"]}>
            {envs.map((e) => (
              <tr key={e.name}>
                <td className={`${td} font-medium`}>{e.name}</td>
                <td className={td}>{e.cell ?? "—"}</td>
                <td className={td}>{e.region ?? "—"}</td>
                <td className={td}>{e.url ? <a className="underline" href={e.url} target="_blank" rel="noreferrer">{e.url}</a> : "—"}</td>
              </tr>
            ))}
          </Table>
        )}
        {canEdit && (
          <form action={saveEnvironment} className="mt-3 flex flex-wrap items-end gap-3">
            {hidden}
            <label className="text-sm">Environment<br /><Select name="name" options={ENV_NAMES} /></label>
            <label className="text-sm">Cell<br /><input name="cell" autoComplete="off" className={inputCls} placeholder="konnect-dev" /></label>
            <label className="text-sm">Region<br /><input name="region" autoComplete="off" className={inputCls} /></label>
            <label className="text-sm">URL<br /><input name="url" autoComplete="off" className={inputCls} placeholder="https://…" /></label>
            <button className={btnCls}>Save environment</button>
          </form>
        )}
      </Section>

      <Section title="Declared package versions">
        {pins.length === 0 ? <Notice>No versions declared.</Notice> : (
          <Table head={["Environment", "Package", "Declared", ...(canEdit ? [""] : [])]}>
            {pins.map((p) => (
              <tr key={`${p.environment}/${p.package}`}>
                <td className={td}>{p.environment}</td>
                <td className={`${td} font-medium`}>{p.package}</td>
                <td className={td}>{p.version}</td>
                {canEdit && (
                  <td className={td}>
                    <form action={removePin}>{hidden}<input type="hidden" name="environment" value={p.environment} /><input type="hidden" name="package" value={p.package} /><button className={linkBtnCls}>Remove</button></form>
                  </td>
                )}
              </tr>
            ))}
          </Table>
        )}
        {canEdit && envs.length > 0 && (
          <form action={setPin} className="mt-3 flex flex-wrap items-end gap-3">
            {hidden}
            <label className="text-sm">Environment<br /><Select name="environment" options={envs.map((e) => e.name)} /></label>
            <label className="text-sm">Package<br /><input name="package" autoComplete="off" className={inputCls} placeholder="@tindevelopers/ui-shell" required /></label>
            <label className="text-sm">Version<br /><input name="version" autoComplete="off" className={inputCls} placeholder="1.2.0" required /></label>
            <button className={btnCls}>Declare version</button>
          </form>
        )}
        {canEdit && envs.length === 0 && <p className="mt-3 text-sm text-gray-500">Add an environment first; versions are declared per environment.</p>}
      </Section>

      {reports && (
        <Section title="Declared versus reported">
          <ReportedPins comparisons={comparisons} result={reports} />
        </Section>
      )}

      <Section title="Owners">
        {assignments.length === 0 ? <Notice>No one is assigned.</Notice> : (
          <Table head={["Person", "Role", "Assigned by", "Since", ...(canEdit ? [""] : [])]}>
            {assignments.map((a) => (
              <tr key={a.id}>
                <td className={`${td} font-medium`}>{a.assignee}</td>
                <td className={td}>{a.role}</td>
                <td className={td}>{a.assignedBy}</td>
                <td className={td}>{fmt(a.assignedAt)}</td>
                {canEdit && <td className={td}><form action={unassign}>{hidden}<input type="hidden" name="id" value={a.id} /><button className={linkBtnCls}>Unassign</button></form></td>}
              </tr>
            ))}
          </Table>
        )}
        {canEdit && (
          <form action={assign} className="mt-3 flex flex-wrap items-end gap-3">
            {hidden}
            <label className="text-sm">Email<br /><input name="assignee" type="email" autoComplete="off" className={inputCls} required /></label>
            <label className="text-sm">Role<br /><Select name="role" options={ASSIGN_ROLES} /></label>
            <button className={btnCls}>Assign</button>
          </form>
        )}
      </Section>

      <Section title="Relationships">
        {out.length + into.length === 0 ? <Notice>No relationships declared.</Notice> : (
          <ul className="space-y-1 text-sm">
            {out.map((r) => (
              <li key={`o-${r.toSlug}-${r.relation}`} className="flex items-center gap-3">
                <span>{project.slug} <b>{r.relation}</b> <a className="underline" href={`/projects/${r.toSlug}`}>{r.toSlug}</a></span>
                {canEdit && <form action={removeRelation}>{hidden}<input type="hidden" name="to" value={r.toSlug} /><input type="hidden" name="relation" value={r.relation} /><button className={linkBtnCls}>Remove</button></form>}
              </li>
            ))}
            {into.map((r) => (
              <li key={`i-${r.fromSlug}-${r.relation}`}><a className="underline" href={`/projects/${r.fromSlug}`}>{r.fromSlug}</a> <b>{r.relation}</b> {project.slug}</li>
            ))}
          </ul>
        )}
        {canEdit && (
          <form action={addRelation} className="mt-3 flex flex-wrap items-end gap-3">
            {hidden}
            <label className="text-sm">This project<br /><Select name="relation" options={RELATIONS} /></label>
            <label className="text-sm">Project<br /><Select name="to" options={reg.projects.filter((p) => p.slug !== slug).map((p) => p.slug)} /></label>
            <button className={btnCls}>Add</button>
          </form>
        )}
      </Section>

      {canEdit && (
        <Section title="Project details">
          <form action={saveProject} className="flex flex-wrap items-end gap-3">
            {hidden}
            <label className="text-sm">Name<br /><input name="name" autoComplete="off" className={inputCls} defaultValue={project.name} required /></label>
            <label className="text-sm">Kind<br /><Select name="kind" options={KINDS} defaultValue={project.kind} /></label>
            <label className="text-sm">Client<br /><input name="client" autoComplete="off" className={inputCls} defaultValue={project.client ?? ""} /></label>
            <label className="text-sm">Repo<br /><input name="repo" autoComplete="off" className={inputCls} defaultValue={project.repo ?? ""} /></label>
            <label className="text-sm">Path in repo<br /><input name="path" autoComplete="off" placeholder="apps/ops" className={inputCls} defaultValue={project.path ?? ""} /></label>
            <label className="text-sm">Lifecycle<br /><Select name="lifecycle" options={LIFECYCLES} defaultValue={project.lifecycle} /></label>
            <label className="text-sm">Owned by<br />
              <select name="ownerProject" autoComplete="off" defaultValue={project.ownerProject ?? ""} className={inputCls}>
                <option value="">(none)</option>
                {reg.projects.map((x) => <option key={x.slug} value={x.slug}>{x.slug === slug ? `${x.name} (itself)` : x.name}</option>)}
              </select>
            </label>
            <label className="text-sm">Owning group<br />
              <select name="ownerGroup" autoComplete="off" defaultValue={project.ownerGroup ?? ""} className={inputCls}>
                <option value="">(none)</option>
                {groups.map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
              </select>
            </label>
            <label className="text-sm">Tier<br />
              <select name="tier" autoComplete="off" defaultValue={project.tier ?? ""} className={inputCls}>
                <option value="">(none)</option>
                {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="text-sm">Notes<br /><input name="notes" autoComplete="off" className={inputCls} defaultValue={project.notes ?? ""} /></label>
            <button className={btnCls}>Save</button>
          </form>
        </Section>
      )}
    </div>
  );
}
