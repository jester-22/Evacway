import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faDownload,
  faEye,
  faFileExcel,
  faMagnifyingGlass,
  faPlus,
  faRotate,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../services/api";
import { displayEntityName } from "../utils/displayEntityName";
import "../components_css/FamilyManagement.css";

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function FamilyManagement({ barangays = [] }) {
  const [families, setFamilies] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [barangayId, setBarangayId] = useState("");
  const [assignmentStatus, setAssignmentStatus] = useState("");
  const [sortBy, setSortBy] = useState("family_code");
  const [direction, setDirection] = useState("asc");
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState("");
  const [selectedFamily, setSelectedFamily] = useState(null);
  const [familyDetail, setFamilyDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [form, setForm] = useState({
    family_code: "",
    head_name: "",
    barangay_id: "",
    contact_number: "",
    address: "",
    members: [],
  });
  const [saving, setSaving] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importBusy, setImportBusy] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    const filters = {
      page,
      per_page: 20,
      search,
      barangay_id: barangayId,
      assignment_status: assignmentStatus,
      sort_by: sortBy,
      direction,
    };

    api.getFamilies(filters)
      .then((result) => {
        if (cancelled) return;
        setFamilies(result.items || []);
        setTotal(result.total || 0);
        setPages(Math.max(1, result.pages || 1));
        setError("");
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message || "Families could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [page, search, barangayId, assignmentStatus, sortBy, direction, refreshKey]);

  function closeModal() {
    if (saving || importBusy) return;
    setModal("");
    setError("");
    setNotice("");
    setImportPreview(null);
    setImportFile(null);
  }

  function openAddFamily() {
    setForm({ family_code: "", head_name: "", barangay_id: barangayId || "", contact_number: "", address: "", members: [] });
    setError("");
    setNotice("");
    setModal("add");
  }

  async function openFamily(item) {
    setSelectedFamily(item);
    setFamilyDetail(null);
    setDetailLoading(true);
    setModal("detail");
    try {
      setFamilyDetail(await api.getFamily(item.id));
    } catch (requestError) {
      setError(requestError.message || "Family details could not be loaded.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function submitFamily(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        barangay_id: Number(form.barangay_id),
        members: form.members.filter((member) => member.full_name.trim()).map((member) => ({ full_name: member.full_name.trim() })),
      };
      const result = await api.addFamily(payload);
      setNotice(result.message || "Family registered.");
      setModal("");
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      setError(requestError.message || "Family could not be registered.");
    } finally {
      setSaving(false);
    }
  }

  async function downloadTemplate() {
    setError("");
    try {
      saveBlob(await api.downloadFamilyTemplate(), "evacway-family-template.xlsx");
    } catch (requestError) {
      setError(requestError.message || "The Excel template could not be downloaded.");
    }
  }

  async function exportFamilies() {
    setError("");
    try {
      const filters = { search, barangay_id: barangayId, assignment_status: assignmentStatus };
      saveBlob(await api.exportFamilies(filters), "evacway-families.csv");
    } catch (requestError) {
      setError(requestError.message || "The filtered family list could not be exported.");
    }
  }

  async function previewImport() {
    if (!importFile) return;
    setImportBusy(true);
    setError("");
    setImportPreview(null);
    try {
      setImportPreview(await api.previewFamilyImport(importFile));
    } catch (requestError) {
      setError(requestError.message || "The workbook could not be previewed.");
    } finally {
      setImportBusy(false);
    }
  }

  async function commitImport() {
    if (!importFile || !importPreview?.can_import) return;
    setImportBusy(true);
    setError("");
    try {
      const result = await api.previewFamilyImport(importFile, true);
      setNotice(result.message || `Imported ${result.successful_families} families.`);
      setModal("");
      setImportPreview(null);
      setImportFile(null);
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      setError(requestError.message || "The import failed. No records were committed.");
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <section className="family-manager" aria-labelledby="family-manager-title">
      <header className="family-manager-header">
        <div>
          <p className="family-manager-kicker">Barangay records</p>
          <h2 id="family-manager-title">Families</h2>
          <p>Registered households and their current evacuation assignments.</p>
        </div>
        <div className="family-manager-actions">
          <button type="button" className="fm-button fm-button-quiet" onClick={downloadTemplate}><FontAwesomeIcon icon={faDownload} /> Template</button>
          <button type="button" className="fm-button fm-button-quiet" onClick={() => { setImportFile(null); setImportPreview(null); setError(""); setModal("import"); }}><FontAwesomeIcon icon={faFileExcel} /> Import Excel</button>
          <button type="button" className="fm-button fm-button-quiet" onClick={exportFamilies}><FontAwesomeIcon icon={faDownload} /> Export CSV</button>
          <button type="button" className="fm-button fm-button-primary" onClick={openAddFamily}><FontAwesomeIcon icon={faPlus} /> Add Family</button>
        </div>
      </header>

      {notice && <p className="fm-notice" role="status">{notice}</p>}
      {error && !modal && <p className="fm-error" role="alert">{error}</p>}

      <div className="family-manager-filters">
        <label className="fm-search">
          <FontAwesomeIcon icon={faMagnifyingGlass} />
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search code, head, address, or contact" aria-label="Search families" />
        </label>
        <select aria-label="Filter by barangay" value={barangayId} onChange={(event) => { setBarangayId(event.target.value); setPage(1); }}>
          <option value="">All barangays</option>
          {barangays.map((barangay) => <option key={barangay.id} value={barangay.id}>{displayEntityName(barangay.name, `Barangay ${barangay.id}`)}</option>)}
        </select>
        <select aria-label="Filter by assignment" value={assignmentStatus} onChange={(event) => { setAssignmentStatus(event.target.value); setPage(1); }}>
          <option value="">All assignment statuses</option>
          <option value="assigned">Assigned</option>
          <option value="unassigned">Not assigned</option>
        </select>
        <select aria-label="Sort families" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
          <option value="family_code">Sort: Family code</option>
          <option value="head_name">Sort: Head of family</option>
          <option value="barangay">Sort: Barangay</option>
          <option value="member_count">Sort: Members</option>
          <option value="created_at">Sort: Date registered</option>
          <option value="evacuation_status">Sort: Status</option>
        </select>
        <button type="button" className="fm-sort-direction" onClick={() => setDirection((value) => value === "asc" ? "desc" : "asc")} aria-label={`Sort ${direction === "asc" ? "descending" : "ascending"}`} title={`Sort ${direction === "asc" ? "descending" : "ascending"}`}>
          {direction === "asc" ? "A–Z" : "Z–A"}
        </button>
      </div>

      <div className="fm-table-wrap">
        <table className="fm-table">
          <thead><tr><th>Family / Household ID</th><th>Head of family</th><th>Members</th><th>Barangay</th><th>Contact</th><th>Evacuation center / room</th><th>Status</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan="8" className="fm-empty">Loading family records…</td></tr> : error ? <tr><td colSpan="8" className="fm-empty fm-error-text">{error}</td></tr> : families.length === 0 ? <tr><td colSpan="8" className="fm-empty">No registered families match these filters.</td></tr> : families.map((family) => (
              <tr key={family.id}>
                <td><button type="button" className="fm-family-code" onClick={() => openFamily(family)}>{family.family_code || `#${family.id}`}</button></td>
                <td>{displayEntityName(family.head_name, "Unnamed family")}</td>
                <td>{family.member_count ?? family.resident_count ?? 0}</td>
                <td>{displayEntityName(family.barangay, "—")}</td>
                <td>{family.contact_number || "—"}</td>
                <td>{[family.evacuation_center, family.rooms].filter(Boolean).join(" · ") || "Not assigned"}</td>
                <td><span className={`fm-status ${family.assigned_members ? "is-assigned" : ""}`}>{family.evacuation_status || "Not assigned"}</span></td>
                <td><button type="button" className="fm-icon-button" aria-label={`View ${family.family_code}`} title="View family" onClick={() => openFamily(family)}><FontAwesomeIcon icon={faEye} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="family-manager-pagination">
        <span>{total === 0 ? "0 families" : `${(page - 1) * 20 + 1}–${Math.min(page * 20, total)} of ${total} families`}</span>
        <div>
          <button type="button" className="fm-button fm-button-quiet" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button type="button" className="fm-button fm-button-quiet" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)}>Next</button>
          <button type="button" className="fm-icon-button" onClick={() => setRefreshKey((value) => value + 1)} aria-label="Refresh families" title="Refresh"><FontAwesomeIcon icon={faRotate} /></button>
        </div>
      </footer>

      {modal === "add" && (
        <div className="fm-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}>
          <form className="fm-modal" onSubmit={submitFamily}>
            <header className="fm-modal-header"><div><p>Family registration</p><h3>Add Family</h3></div><button type="button" className="fm-icon-button" onClick={closeModal} aria-label="Close"><FontAwesomeIcon icon={faXmark} /></button></header>
            {error && <p className="fm-error" role="alert">{error}</p>}
            <div className="fm-modal-body">
              <label>Family code <span>Optional; generated if blank</span><input value={form.family_code} maxLength={100} onChange={(event) => setForm({ ...form, family_code: event.target.value })} placeholder="Auto-generated" /></label>
              <label>Head of family<input required maxLength={150} value={form.head_name} onChange={(event) => setForm({ ...form, head_name: event.target.value })} /></label>
              <label>Barangay<select required value={form.barangay_id} onChange={(event) => setForm({ ...form, barangay_id: event.target.value })}><option value="">Select barangay</option>{barangays.map((barangay) => <option key={barangay.id} value={barangay.id}>{displayEntityName(barangay.name, `Barangay ${barangay.id}`)}</option>)}</select></label>
              <label>Contact number<input maxLength={20} value={form.contact_number} onChange={(event) => setForm({ ...form, contact_number: event.target.value })} /></label>
              <label>Address / purok<input maxLength={255} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
              <div className="fm-member-editor"><div className="fm-member-editor-head"><strong>Additional family members</strong><button type="button" className="fm-text-button" onClick={() => setForm({ ...form, members: [...form.members, { full_name: "" }] })}><FontAwesomeIcon icon={faPlus} /> Add member</button></div>
                {form.members.map((member, index) => <div className="fm-member-row" key={index}><input aria-label={`Additional member ${index + 1} full name`} placeholder="Full name" value={member.full_name} onChange={(event) => setForm({ ...form, members: form.members.map((item, itemIndex) => itemIndex === index ? { ...item, full_name: event.target.value } : item) })} /><button type="button" className="fm-icon-button" aria-label={`Remove member ${index + 1}`} onClick={() => setForm({ ...form, members: form.members.filter((_, itemIndex) => itemIndex !== index) })}><FontAwesomeIcon icon={faXmark} /></button></div>)}
                <small>The household head is saved as a resident automatically.</small>
              </div>
            </div>
            <footer className="fm-modal-actions"><button type="button" className="fm-button fm-button-quiet" onClick={closeModal} disabled={saving}>Cancel</button><button type="submit" className="fm-button fm-button-primary" disabled={saving}>{saving ? "Saving…" : "Register family"}</button></footer>
          </form>
        </div>
      )}

      {modal === "import" && (
        <div className="fm-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}>
          <section className="fm-modal fm-import-modal" role="dialog" aria-modal="true" aria-labelledby="fm-import-title">
            <header className="fm-modal-header"><div><p>Bulk registration</p><h3 id="fm-import-title">Import families</h3></div><button type="button" className="fm-icon-button" onClick={closeModal} aria-label="Close"><FontAwesomeIcon icon={faXmark} /></button></header>
            {error && <p className="fm-error" role="alert">{error}</p>}
            <div className="fm-modal-body">
              <p className="fm-import-help">Use the template. Include one row per family member and repeat each family’s code, head, and barangay on every row. The household head must also appear as a member.</p>
              <button type="button" className="fm-button fm-button-quiet" onClick={downloadTemplate}><FontAwesomeIcon icon={faDownload} /> Download Excel Template</button>
              <label className="fm-file-field">Excel workbook (.xlsx)<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setImportFile(event.target.files?.[0] || null); setImportPreview(null); }} /></label>
              <button type="button" className="fm-button fm-button-primary" disabled={!importFile || importBusy} onClick={previewImport}>{importBusy ? "Checking workbook…" : "Preview import"}</button>
              {importPreview && <div className="fm-import-preview">
                <strong>{importPreview.families.length} family groups · {importPreview.rows} member rows</strong>
                {importPreview.errors.length > 0 ? <ul className="fm-import-errors">{importPreview.errors.map((item, index) => <li key={`${item.row}-${index}`}>Row {item.row}: {item.message}</li>)}</ul> : <div className="fm-preview-list">{importPreview.families.map((family) => <div key={family.family_code}><strong>{displayEntityName(family.family_code)}</strong><span>{displayEntityName(family.head_name)} · {displayEntityName(family.barangay)} · {family.member_count} members</span></div>)}</div>}
              </div>}
            </div>
            <footer className="fm-modal-actions"><button type="button" className="fm-button fm-button-quiet" onClick={closeModal} disabled={importBusy}>Cancel</button><button type="button" className="fm-button fm-button-primary" disabled={!importPreview?.can_import || importBusy} onClick={commitImport}>{importBusy ? "Importing…" : `Import ${importPreview?.families.length || 0} families`}</button></footer>
          </section>
        </div>
      )}

      {modal === "detail" && selectedFamily && (
        <div className="fm-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}>
          <section className="fm-modal" role="dialog" aria-modal="true" aria-labelledby="fm-detail-title">
            <header className="fm-modal-header"><div><p>{familyDetail?.family_code || selectedFamily.family_code}</p><h3 id="fm-detail-title">{familyDetail?.head_name || selectedFamily.head_name}</h3></div><button type="button" className="fm-icon-button" onClick={closeModal} aria-label="Close"><FontAwesomeIcon icon={faXmark} /></button></header>
            <div className="fm-modal-body">{detailLoading ? <p>Loading members…</p> : <><p>{displayEntityName(familyDetail?.barangay ?? selectedFamily.barangay, "Barangay not recorded")} · {familyDetail?.member_count || selectedFamily.member_count} members</p><p>{displayEntityName(familyDetail?.contact_number ?? selectedFamily.contact_number, "No contact number")}</p><div className="fm-preview-list">{(familyDetail?.members || []).map((member) => <div key={member.id}><strong>{displayEntityName(member.full_name ?? `${member.first_name} ${member.last_name}`, "Unnamed member")}</strong><span>{displayEntityName(member.address, "Address not recorded")}</span></div>)}</div></>}</div>
            <footer className="fm-modal-actions"><button type="button" className="fm-button fm-button-quiet" onClick={closeModal}>Close</button></footer>
          </section>
        </div>
      )}
    </section>
  );
}