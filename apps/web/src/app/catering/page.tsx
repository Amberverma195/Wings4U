import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Check, MapPin, Phone } from "lucide-react";
import { createPageMetadata } from "@/lib/seo/metadata";
import styles from "./catering.module.css";

export const metadata: Metadata = createPageMetadata({
  title: "Catering",
  description: "Bring Wings 4 U to your next gathering. Call (519) 488-0800 to discuss catering in London, Ontario.",
  path: "/catering",
});

const occasions = [
  { title: "Office lunches", description: "Give the team something to look forward to. Bring everyone together over wings and sides." },
  { title: "Parties & celebrations", description: "Birthdays, milestones or just because. Make great food part of the occasion." },
  { title: "Game-day gatherings", description: "Your favourite people. Your favourite team. A spread worth cheering for." },
];

export default function CateringPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="catering-title">
        <div>
          <p className={styles.eyebrow}>Wings 4 U catering</p>
          <h1 id="catering-title">Big gatherings.<br /><span>Bigger flavour.</span></h1>
          <p className={styles.intro}>Bring the wings. Bring the crowd. From office lunches to game-day get-togethers, let’s talk food for your next event.</p>
          <div className={styles.actions}>
            <a className={styles.primary} href="tel:+15194880800"><Phone size={18} aria-hidden="true" /> Call to plan your event</a>
            <a className={styles.secondary} href="#catering-contact">How to get started <ArrowUpRight size={17} aria-hidden="true" /></a>
          </div>
          <p className={styles.location}><MapPin size={15} aria-hidden="true" /> Made for gatherings in London, Ontario</p>
        </div>
        <div className={styles.heroImage}>
          <Image src="/uploads/menu/combo-5lb-cb5405ef.jpeg" alt="A Wings 4 U combo with chicken wings and sides" fill priority sizes="(max-width: 800px) 100vw, 50vw" className={styles.food} />
          <div className={styles.imageCaption}><span>Good food. Great company.</span><strong>WINGS FOR THE WHOLE CREW.</strong></div>
        </div>
      </section>
      <section className={styles.occasions} aria-labelledby="occasions-title">
        <p className={styles.eyebrow}>Any reason to get together</p>
        <h2 id="occasions-title">You bring the occasion.<br />We’ll talk wings.</h2>
        <div className={styles.cards}>
          {occasions.map((occasion, index) => <article className={styles.card} key={occasion.title}>
            <span className={styles.number}>0{index + 1}</span>
            <h3>{occasion.title}</h3><p>{occasion.description}</p>
          </article>)}
        </div>
      </section>
      <section id="catering-contact" className={styles.contact} aria-labelledby="contact-title">
        <div>
          <p className={styles.eyebrow}>Let’s make a plan</p>
          <h2 id="contact-title">Your event.<br /><span>Our kind of conversation.</span></h2>
          <p>Contact us at the store to discuss your gathering, menu choices, pricing and availability. We’ll help you work out the details.</p>
          <ul className={styles.checklist}>
            {['Your event date and preferred time', 'An approximate number of guests', 'Favourite flavours and dietary questions'].map((item) => <li key={item}><Check size={17} aria-hidden="true" />{item}</li>)}
          </ul>
        </div>
        <div className={styles.callCard}>
          <span className={styles.phoneIcon}><Phone size={25} aria-hidden="true" /></span>
          <h3>Contact us for catering</h3>
          <p>Talk directly with the Wings 4 U team.</p>
          <a className={styles.phoneNumber} href="tel:+15194880800">(519) 488-0800 <ArrowUpRight size={24} aria-hidden="true" /></a>
          <address>1544 Dundas St<br />London, ON N5W 3C1</address>
          <p className={styles.note}>Catering arrangements are confirmed with the store. Calling does not place an order.</p>
        </div>
      </section>
      <div className={styles.menuLink}><span>Looking for your usual favourites?</span><Link href="/menu">Explore the menu <ArrowUpRight size={17} aria-hidden="true" /></Link></div>
    </main>
  );
}
