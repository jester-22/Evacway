import "./DataPrivacyNotice.css";

const privacySources = [
  {
    label: "Republic Act No. 10173 — Data Privacy Act of 2012",
    href: "https://officialgazette.gov.ph/2012/08/15/republic-act-no-10173/",
  },
  {
    label: "Implementing Rules and Regulations of the Data Privacy Act",
    href: "https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/",
  },
  {
    label: "Republic Act No. 10175 — Cybercrime Prevention Act of 2012",
    href: "https://officialgazette.gov.ph/2012/09/12/republic-act-no-10175/",
  },
  {
    label: "National Privacy Commission: Data Subject Rights",
    href: "https://privacy.gov.ph/data-subject-rights/",
  },
  {
    label: "Mapbox Product Privacy Policy",
    href: "https://www.mapbox.com/legal/privacy",
  },
];

function ReviewItem({ children }) {
  return <li><strong>Needs confirmation:</strong> {children}</li>;
}

function closeNoticeTab() {
  window.close();
  if (!window.closed) {
    window.location.assign("/");
  }
}

export default function DataPrivacyNotice() {
  return (
    <main className="privacy-notice-page">
      <article className="privacy-notice-card ds-card">
        <header className="privacy-notice-header">
          <p className="privacy-notice-eyebrow">EvacWay · Municipality of Sogod</p>
          <h1>Data Privacy Notice and Terms of Use</h1>
          <p>
            This page explains the information EvacWay handles and the rules for using the service.
          </p>
        </header>

        <aside className="privacy-notice-review" role="note" aria-label="Draft requiring review">
          <strong>Draft for review — not yet approved</strong>
          <p>
            The Municipality of Sogod’s authorized Personal Information Controller, Data Protection
            Officer, and legal reviewer must confirm the marked items before this text is adopted as
            the official notice or agreement.
          </p>
        </aside>

        <nav className="privacy-notice-toc" aria-label="On this page">
          <a href="#privacy-notice">Privacy notice</a>
          <a href="#information">Information handled</a>
          <a href="#rights">Your rights</a>
          <a href="#terms">Terms of use</a>
          <a href="#legal-sources">Legal sources</a>
        </nav>

        <section id="privacy-notice" className="privacy-notice-section">
          <h2>Data Privacy Notice</h2>
          <p>
            EvacWay supports evacuation planning, family assignment lookup, route guidance, hazard
            reporting, and rescue requests for Sogod. The notice below is a draft based on the
            application’s current features.
          </p>
          <p>
            The Data Privacy Act of 2012 (Republic Act No. 10173) and its Implementing Rules and
            Regulations govern personal data processing. They require transparency, a legitimate
            purpose, proportionality, safeguards, and respect for data subject rights. Republic Act
            No. 10175 is the Cybercrime Prevention Act; it addresses offenses such as illegal access
            and interference with computer systems. It is a cybersecurity law, not a privacy notice
            or consent by itself.
          </p>
        </section>

        <section id="information" className="privacy-notice-section">
          <h2>Information EvacWay handles</h2>
          <ul>
            <li>
              <strong>Resident registration and accounts:</strong> name, birthdate, barangay,
              address, contact number, email address, and password credential data.
            </li>
            <li>
              <strong>Family and evacuation records:</strong> family and member names, family code,
              barangay, contact and address details, family size, vulnerability or assistance
              details, and evacuation center, building, room, or check-in assignments.
            </li>
            <li>
              <strong>Rescue requests:</strong> the situation described, selected needs, number of
              people, assistance flags, location description, coordinates, contact details, and any
              photos attached to the request.
            </li>
            <li>
              <strong>Hazard reports:</strong> report type, description, reported location, photos,
              and the account used to submit or review the report.
            </li>
            <li>
              <strong>Location and routing:</strong> when you choose a location feature, your device
              may provide GPS coordinates, or you may place a map pin manually. Online map and route
              requests use Mapbox; those requests may include map coordinates and technical request
              data.
            </li>
            <li>
              <strong>Security and lookup records:</strong> account identifiers, timestamps, IP
              addresses for security controls, and masked family-search fields with a found/no-match
              result. Search logs are designed not to keep searched full names in plain text.
            </li>
          </ul>
          <p>
            Family records can include children’s information and details about disability,
            pregnancy, or assistance needs. Access to roster details is limited to authorized staff
            roles. A resident family-search feature returns a center only and is available only for
            families that choose to be searchable.
          </p>
        </section>

        <section className="privacy-notice-section">
          <h2>Why information is used</h2>
          <ul>
            <li>To review resident account requests and match an account to the correct family record.</li>
            <li>To show authorized residents their own evacuation assignment and help them plan a route.</li>
            <li>To respond to rescue requests and share relevant details with authorized response staff.</li>
            <li>To receive, validate, and manage hazard reports and road closures.</li>
            <li>To secure accounts, limit misuse, investigate service issues, and keep audit records.</li>
          </ul>
          <p>
            The responsible office must identify the lawful basis for each purpose. EvacWay records
            the privacy-consent checkbox, timestamp, and notice version during resident registration;
            that checkbox should not be treated as the legal basis for every other use without the
            Controller’s review.
          </p>
        </section>

        <section className="privacy-notice-section">
          <h2>Who may receive or access information</h2>
          <p>
            Authorized LGU Personnel and admins may access records needed for their assigned duties.
            Rescue request details are made available to authorized response staff. Online map and
            routing requests are sent to Mapbox. Other hosting, email, push-notification, backup, or
            support providers may process information as configured for the deployed service.
          </p>
          <ul className="privacy-notice-review-list">
            <ReviewItem>List the actual service providers, what each receives, and where data is stored or processed.</ReviewItem>
            <ReviewItem>Confirm any data sharing with other LGU offices or emergency responders and the applicable safeguards.</ReviewItem>
          </ul>
        </section>

        <section className="privacy-notice-section">
          <h2>Storage, retention, and security</h2>
          <p>
            EvacWay uses role-based access controls and security logging. Personal data should be
            retained only for an approved, documented period and securely deleted or anonymized when
            it is no longer needed, unless a legal duty or valid claim requires longer retention.
          </p>
          <ul className="privacy-notice-review-list">
            <ReviewItem>Publish the retention and deletion schedule for registrations, family records, rescue requests, reports, photos, and logs.</ReviewItem>
            <ReviewItem>Have the LGU IT and privacy officers confirm the security safeguards, backups, storage locations, and breach-response process.</ReviewItem>
          </ul>
        </section>

        <section id="rights" className="privacy-notice-section">
          <h2>Your data privacy rights</h2>
          <p>
            Subject to the conditions and limits in law, you may ask to be informed about processing,
            access or correct your data, object to certain processing, request erasure or blocking,
            request data portability, seek damages where allowed, or file a complaint with the
            National Privacy Commission.
          </p>
          <ul className="privacy-notice-review-list">
            <ReviewItem>Add the approved DPO or privacy contact name, email, telephone number, and office address for requests.</ReviewItem>
            <ReviewItem>Describe the identity-check and response process for access, correction, objection, and deletion requests.</ReviewItem>
          </ul>
          <p>
            You may also read the National Privacy Commission’s guidance on
            {" "}<a href="https://privacy.gov.ph/data-subject-rights/" target="_blank" rel="noreferrer">data subject rights</a>
            {" "}and its
            {" "}<a href="https://privacy.gov.ph/mechanics-for-complaints/" target="_blank" rel="noreferrer">complaint process</a>.
          </p>
        </section>

        <section id="terms" className="privacy-notice-section privacy-notice-terms">
          <h2>Terms of Use — draft</h2>
          <p>
            These terms describe responsible use of EvacWay. They are a draft and are not yet a
            separately accepted agreement in the resident sign-up flow.
          </p>
          <ul>
            <li>Use your account only for your own authorized access. Keep your sign-in details private.</li>
            <li>Use family lookup only for legitimate safety coordination. Do not copy, publish, or misuse another family’s information.</li>
            <li>Submit accurate rescue and hazard information. Upload only photos you are authorized to share.</li>
            <li>Do not access another account or data without permission, alter records without authority, or interfere with the service.</li>
            <li>
              Map routes, hazard reports, and center information can be delayed or incomplete. Follow
              current directions from emergency responders and local authorities; EvacWay does not
              replace emergency response services.
            </li>
          </ul>
          <p>
            Before these terms become an agreement, the LGU must approve the final text, define how
            users accept it, and state how future changes will be communicated. The current sign-up
            checkbox records Data Privacy Notice consent only.
          </p>
        </section>

        <section id="legal-sources" className="privacy-notice-section">
          <h2>Legal and service references</h2>
          <ul>
            {privacySources.map((source) => (
              <li key={source.href}>
                <a href={source.href} target="_blank" rel="noreferrer">{source.label}</a>
              </li>
            ))}
          </ul>
        </section>

        <aside className="privacy-notice-review" role="note">
          <strong>Items to complete before adoption</strong>
          <ul className="privacy-notice-review-list">
            <ReviewItem>Confirm the Personal Information Controller’s official name and address.</ReviewItem>
            <ReviewItem>Add the DPO/privacy contact and approved rights-request channel.</ReviewItem>
            <ReviewItem>Confirm lawful bases, recipients, provider arrangements, retention periods, and security/breach details.</ReviewItem>
            <ReviewItem>Approve the Terms of Use, effective date, and version. Update the version used when recording sign-up consent.</ReviewItem>
          </ul>
        </aside>

        <footer className="privacy-notice-footer">
          <button type="button" onClick={closeNoticeTab} className="ds-btn ds-btn--ghost">
            Close tab
          </button>
          <span>Draft only · No effective date set</span>
        </footer>
      </article>
    </main>
  );
}
