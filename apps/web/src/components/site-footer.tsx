import { WingsBrandLockup } from "@/components/wings-brand-lockup";
import { FooterMenuLinks } from "@/components/footer-menu-links";

export function SiteFooter() {
  return (
    <footer id="footer">
      <div className="footer-top">
        <div className="footer-brand">
          <WingsBrandLockup
            href="/"
            ariaLabel="Back to home"
            className="footer-brand-link"
            style={{ gap: 8, marginBottom: 8, width: "fit-content" }}
            wordmarkClassName="nav-brand"
            imageSize={44}
          />
          <p>
            London&apos;s newest wing house. Hand-breaded. 70+ sauces. Pickup &amp; delivery. No
            compromises.
          </p>
        </div>

        <div className="footer-col footer-col--menu">
          <FooterMenuLinks />
        </div>

        <div className="footer-col footer-col--visit">
          <h4>Visit</h4>
          <p>London, ON</p>
          <p className="footer-address">
            Address: Wings 4 U, 1544 Dundas St, London, ON N5W 3C1
          </p>
          <details className="footer-hours-disclosure">
            <summary className="footer-hours-toggle">Store Hours</summary>
            <div className="footer-hours" aria-label="Store hours">
              <p>Tuesday: 11 a.m. {"\u2013"} 1 a.m.</p>
              <p>Wednesday: 11 a.m. {"\u2013"} 1 a.m.</p>
              <p>Thursday: 11 a.m. {"\u2013"} 1 a.m.</p>
              <p>Friday: 11 a.m. {"\u2013"} 2:30 a.m.</p>
              <p>Saturday: 11 a.m. {"\u2013"} 2:30 a.m.</p>
              <p>Sunday: 11 a.m. {"\u2013"} 1 a.m.</p>
              <p>Monday: 11 a.m. {"\u2013"} 1 a.m.</p>
            </div>
          </details>
        </div>

        <div className="footer-col footer-col--info">
          <h4>Info</h4>
          <a href="#">Nutrition</a>
          <a href="#">Allergens</a>
          <a href="#">Careers</a>
          <a href="#">Press</a>
        </div>
      </div>

      <div className="footer-bottom">
        <p>
          {"\u00A9"} {new Date().getFullYear()} Wings4U. All rights reserved. All wings hand-breaded daily.
        </p>
        <div className="footer-social" aria-label="Social links">
          <a className="social-btn" href="#" aria-label="Instagram">
            {"\u{1F4F7}"}
          </a>
          <a className="social-btn" href="#" aria-label="TikTok">
            {"\u{1F3B5}"}
          </a>
          <a className="social-btn" href="#" aria-label="X (Twitter)">
            {"\u{1F426}"}
          </a>
        </div>
      </div>
    </footer>
  );
}
