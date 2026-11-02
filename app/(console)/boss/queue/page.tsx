import Link from "next/link";
import { requireOperator } from "@/src/auth/access";
import { operatorBearer } from "@/src/auth/token";
import { isUuid } from "@/src/boss/operator";
import { QUEUE_SCOPE, describeQueueFailure, listQueue } from "@/src/boss/queue";
import { ageLabel } from "@/src/status/format";
import { currentTenant } from "@/src/tenancy/tenant";
import { EmptyRow, PageHeader, Panel, StatusChip, buttonPrimary, buttonSecondary } from "@/components/ControlPlane";
import { Notice, fmt, td } from "@/components/StatusUi";
import { decideAction } from "./actions";

export const dynamic = "force-dynamic";

const mono = "font-mono text-xs";
const neutral = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300";
const danger = "inline-flex min-h-9 items-center rounded-md border border-red-300 bg-white px-3.5 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-500/10";

/**
 * The review queue: platform documents awaiting review, as BOSS lists them for the signed-in operator. Accept publishes the listed
 * revision; reject returns the document to draft. The decision names ids only; the text is read where the document lives. A cell
 * serves this only with the knowledge login (a Neon Auth cell); tin-production has none.
 */
export default async function QueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const op = await requireOperator();
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";
  const after = one("after").toLowerCase();
  const tenant = await currentTenant();
  const now = new Date();
  const result = await listQueue(await operatorBearer(), { after: isUuid(after) ? after : null });
  const items = result.status === "ok" ? result.items : [];
  const isAdmin = op.role === "admin";
  const oldest = items.reduce<Date | null>((m, i) => (m === null || i.submittedAt < m ? i.submittedAt : m), null);

  return (
    <div>
      <PageHeader tenant={tenant.slug} title="Review queue" crumb="Review queue" crumbParent="BOSS" subtitle="Platform documents awaiting review, as BOSS lists them for you. Accept publishes the revision shown; reject returns it to draft. Read the document where it lives; decide here.">
        <span className={neutral}>{result.status === "ok" ? `${items.length} waiting${result.nextCursor ? "+" : ""}` : "unavailable"}</span>
        {oldest && <span className={neutral}>oldest {ageLabel(oldest, now)}</span>}
        <Link href="/boss/releases" className={buttonPrimary}>Releases</Link>
      </PageHeader>

      {one("accepted") && (
        <p role="status" className="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-500/40 dark:bg-green-500/10 dark:text-green-200">
          Published <span className="font-medium">{one("accepted")}</span>. It leaves the queue; the next release built will carry it.
        </p>
      )}
      {one("rejected") && (
        <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          Returned <span className="font-medium">{one("rejected")}</span> to draft. Its author sees it there; no reason travels, so tell them where it lives.
        </p>
      )}
      {one("error") && <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">{one("error")}</p>}

      {result.status !== "ok" ? (
        <Notice>{describeQueueFailure(result)}</Notice>
      ) : items.length === 0 ? (
        <Panel title="Waiting for review"><EmptyRow>{after ? "No more documents on this page." : "Nothing is waiting for your review."}</EmptyRow></Panel>
      ) : (
        <Panel title="Waiting for review">
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 dark:bg-white/5 dark:text-gray-400">
                <tr><th className="px-4 py-3 font-medium">Document</th><th className="px-4 py-3 font-medium">Space</th><th className="px-4 py-3 font-medium">Revision</th><th className="px-4 py-3 font-medium">Submitted</th><th className="px-4 py-3 font-medium">Updated</th>{isAdmin && <th className="px-4 py-3 font-medium">Decision</th>}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {items.map((i) => {
                  const stale = i.updatedAt.getTime() - i.submittedAt.getTime() > 60_000;
                  return (
                    <tr key={i.documentId}>
                      <td className={td}><span className="font-medium text-gray-800 dark:text-white/90">{i.title}</span><div className={`${mono} text-gray-500 dark:text-gray-400`}>{i.documentId}</div></td>
                      <td className={td}>{i.spaceName}<div className={`${mono} text-gray-500 dark:text-gray-400`}>{i.spaceId}</div></td>
                      <td className={td}><span className={neutral}>rev {i.revisionNumber}</span><div className={`${mono} text-gray-500 dark:text-gray-400`}>{i.revisionId.slice(0, 8)}</div></td>
                      <td className={td} title={fmt(i.submittedAt)}>{ageLabel(i.submittedAt, now)}</td>
                      <td className={td} title={fmt(i.updatedAt)}>{stale ? <StatusChip colour="amber" label={`edited ${ageLabel(i.updatedAt, now)}`} /> : ageLabel(i.updatedAt, now)}</td>
                      {isAdmin && (
                        <td className={td}>
                          <div className="flex flex-wrap gap-2">
                            <form action={decideAction}>
                              <input type="hidden" name="documentId" value={i.documentId} /><input type="hidden" name="revisionId" value={i.revisionId} /><input type="hidden" name="decision" value="accept" />
                              <button className={buttonSecondary} aria-label={`Accept ${i.title} at revision ${i.revisionNumber}`}>Accept</button>
                            </form>
                            <form action={decideAction}>
                              <input type="hidden" name="documentId" value={i.documentId} /><input type="hidden" name="revisionId" value={i.revisionId} /><input type="hidden" name="decision" value="reject" />
                              <button className={danger} aria-label={`Reject ${i.title} at revision ${i.revisionNumber}`}>Reject</button>
                            </form>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
            <p>A decision names the document and the revision listed here; if the document changes first, BOSS refuses and the queue is re-read. &quot;Edited&quot; marks a document changed after it was submitted: read it again before deciding. Needs the console&apos;s operator key with <span className={mono}>{QUEUE_SCOPE}</span> and you on BOSS&apos;s operator list.</p>
            {result.nextCursor && <Link href={`/boss/queue?after=${result.nextCursor}`} className={buttonSecondary}>Next page</Link>}
          </div>
        </Panel>
      )}
      {!isAdmin && result.status === "ok" && items.length > 0 && <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Admins decide; viewers read the queue.</p>}
    </div>
  );
}
