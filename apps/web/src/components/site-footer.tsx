import { WingsBrandLockup } from "@/components/wings-brand-lockup";
import { FooterMenuLinks } from "@/components/footer-menu-links";
import { FooterStoreHours } from "@/components/footer-store-hours";

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
            imageSize={44}
            wordmarkImageSrc="/Logo_title.png"
            wordmarkImageHeight={34}
            wordmarkImageWidth={163}
          />
          <p>
            London&apos;s newest wing house. Hand-breaded. 74+ sauces. Pickup &amp; delivery. No
            compromises.
          </p>
        </div>

        <div className="footer-col footer-col--menu">
          <FooterMenuLinks />
        </div>

        <div className="footer-col footer-col--visit">
          <h3>Visit</h3>
          <p>London, ON</p>
          <p className="footer-address">
            Address: Wings 4 U, 1544 Dundas St, London, ON N5W 3C1
          </p>
          <FooterStoreHours />
        </div>
      </div>

      <div className="footer-bottom">
        <p>
          {"\u00A9"} {new Date().getFullYear()} Wings4U. All rights reserved. All wings hand-breaded daily.
        </p>
      </div>
    </footer>
  );
}
