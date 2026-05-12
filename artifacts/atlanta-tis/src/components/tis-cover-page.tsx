/**
 * Branded TIS cover page — first page of the printable PDF.
 *
 * Pulls firm branding from props (sourced from localStorage) and project
 * metadata from the project-form fields. Includes a PE stamp box that the
 * licensed engineer can sign over after print.
 */
import type { TisReport } from "@workspace/tis-api-client-react";
import { ShieldCheck } from "lucide-react";
import type { FirmBranding, ProjectMetadata } from "../lib/firm-branding";

interface Props {
  report: TisReport;
  firm: FirmBranding;
  meta: ProjectMetadata;
}

export function TisCoverPage({ report, firm, meta }: Props) {
  return (
    <section
      className="hidden print:flex print:flex-col print:h-[10in] print:break-after-page"
      data-testid="tis-cover-page"
    >
      <header className="flex items-start justify-between border-b-4 border-blue-600 pb-4 mb-8">
        {firm.logoDataUrl ? (
          <img
            src={firm.logoDataUrl}
            alt={firm.firmName}
            className="h-20 max-w-[3in] object-contain"
          />
        ) : (
          <div className="h-20 flex items-center text-3xl font-bold text-blue-700">
            {firm.firmName || "Your Firm"}
          </div>
        )}
        <div className="text-right text-xs leading-snug">
          <div className="font-bold text-base">{firm.firmName || "Your Firm Name"}</div>
          {firm.firmAddress && <div>{firm.firmAddress}</div>}
          {firm.firmPhone && <div>{firm.firmPhone}</div>}
        </div>
      </header>

      <div className="flex-1 flex flex-col justify-center text-center px-8">
        <div className="text-xs uppercase tracking-[0.3em] text-blue-700 font-semibold mb-3">
          Traffic Impact Study
        </div>
        <h1 className="text-5xl font-bold mb-3 leading-tight">{report.request.projectName}</h1>
        <p className="text-lg text-gray-700 mb-1">{report.request.address}</p>
        <p className="text-sm text-gray-500 mb-12">
          Lat {report.request.latitude.toFixed(5)} · Lon {report.request.longitude.toFixed(5)}
        </p>

        <div className="grid grid-cols-2 gap-x-12 gap-y-4 max-w-2xl mx-auto text-sm">
          <CoverField label="Project Number" value={meta.projectNumber} />
          <CoverField label="Revision" value={meta.revisionNumber} />
          <CoverField label="Client" value={meta.client} />
          <CoverField label="Prepared For" value={meta.preparedFor} />
          <CoverField label="Prepared By" value={firm.preparedBy} />
          <CoverField label="Reviewer" value={meta.reviewerName} />
          <CoverField label="Study Date" value={formatDate(meta.studyDate)} />
          <CoverField label="Opening Year" value={String(report.request.openingYear)} />
        </div>
      </div>

      <PeStampBlock firm={firm} />

      <footer className="mt-6 pt-3 border-t text-[10px] text-gray-500 text-center">
        This screening-level Traffic Impact Study was prepared in accordance with the
        Highway Capacity Manual (6th Ed.), ITE Trip Generation Manual (11th Ed.), and the
        MUTCD (2009, Rev. 3). See "Methodology &amp; References" appendix for details.
      </footer>
    </section>
  );
}

function CoverField({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-left border-b border-gray-300 pb-1">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 font-medium">{label}</div>
      <div className="text-sm font-semibold mt-0.5 min-h-[20px]">
        {value || <span className="text-gray-400 italic">—</span>}
      </div>
    </div>
  );
}

function PeStampBlock({ firm }: { firm: FirmBranding }) {
  return (
    <div className="grid grid-cols-2 gap-6 pt-6">
      <div className="border-2 border-gray-400 rounded p-4 h-32 flex flex-col">
        <div className="text-[10px] uppercase tracking-wide text-gray-600 font-medium mb-1 flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" /> Professional Engineer Seal
        </div>
        <div className="flex-1" />
        <div className="text-[10px] text-gray-500 italic text-center">
          (Affix PE seal in this box after print)
        </div>
      </div>
      <div className="flex flex-col justify-end gap-3">
        <SignatureLine label="Engineer Signature" />
        <SignatureLine label="Date" />
        <div className="text-[11px] mt-1">
          <div className="font-semibold">{firm.preparedBy || "Engineer name"}</div>
          {firm.peNumber && <div className="text-gray-600">{firm.peNumber}</div>}
        </div>
      </div>
    </div>
  );
}

function SignatureLine({ label }: { label: string }) {
  return (
    <div>
      <div className="border-b border-gray-700 h-6" />
      <div className="text-[10px] text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
